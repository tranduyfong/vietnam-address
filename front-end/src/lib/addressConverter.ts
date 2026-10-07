/**
 * Logic chuyển đổi địa chỉ hành chính Việt Nam (Cũ ⇄ Mới), chạy 100% trên client.
 *
 * Dữ liệu: public/data/admin-2025.json, sinh bởi scripts/build-admin-data.mjs từ bộ dữ liệu
 * mở vietnamadminunits (đối chiếu sapnhap.bando.com.vn + Tổng cục Thống kê):
 * 63 tỉnh / 10.602 dòng mapping xã cũ → 34 tỉnh / 3.321 xã mới (hiệu lực 01/07/2025).
 *
 * Luồng xử lý:
 *   1. tokenize()       – tách chuỗi theo mọi dấu phân cách (, . - / ; | …), có bảo vệ
 *                         viết tắt "P.", "TP.", số nhà "12/3", tên có gạch nối "Bà Rịa - Vũng Tàu".
 *   2. normalizeName()  – chuẩn hóa tên ĐVHC thành khóa so khớp
 *                         (bỏ hoa/thường, tiền tố xã/phường/huyện/tỉnh…, dấu, dấu nháy).
 *   3. buildIndex()     – dựng các bảng băm (Map) để tra O(1).
 *   4. convertAddress() – thử lần lượt các "cách đọc" phần đuôi địa chỉ, tra bảng băm,
 *                         ghép lại với phần chi tiết bằng " - ".
 *   5. suggest()        – khi không tìm thấy: gợi ý tên gần đúng trong cùng tỉnh.
 */

// ---------------------------------------------------------------------------
// Kiểu dữ liệu
// ---------------------------------------------------------------------------

export type Direction = 'oldToNew' | 'newToOld'

/** Dấu phân cách dùng khi ghép địa chỉ kết quả. */
export const OUTPUT_SEPARATOR = ' - '

/** Định dạng gọn của file JSON (mảng thay vì object để giảm dung lượng). */
export interface AdminDataset {
  meta: {
    source: string
    commit: string
    license: string
    origin: string
    effectiveDate: string
    resolution: string
    generatedAt: string
  }
  /** Tỉnh mới: [tên, mô tả các tỉnh cũ hợp thành ("" nếu giữ nguyên)] */
  np: [string, string][]
  /** Xã mới: [chỉ số tỉnh mới, tên, mô tả hình thành từ các xã cũ] */
  nw: [number, string, string][]
  /** Tỉnh cũ */
  op: string[]
  /** Huyện cũ: [chỉ số tỉnh cũ, tên] */
  od: [number, string][]
  /** Mapping: [chỉ số huyện cũ, tên xã cũ, chỉ số xã mới, cờ (1 = bị chia, 2 = xã mới mặc định)] */
  m: [number, string, number, number][]
}

/** Một đơn vị hành chính; district = null với mô hình 2 cấp (từ 01/07/2025). */
export interface AdminUnit {
  ward: string
  district: string | null
  province: string
}

/** Một xã/phường mới kèm thông tin căn cứ. */
export interface NewWard {
  unit: AdminUnit
  /** Mô tả chính thức: hình thành từ những xã cũ nào. */
  formedFrom: string
  /** Mô tả: tỉnh mới hợp nhất từ những tỉnh nào ("" nếu giữ nguyên). */
  provinceFormedFrom: string
  rows: MappingRow[]
}

/** Một dòng mapping xã cũ → xã mới. */
export interface MappingRow {
  old: AdminUnit
  target: NewWard
  /** Xã cũ bị chia cho nhiều xã mới (chỉ một phần thuộc xã mới này). */
  divided: boolean
  /** Khi xã cũ bị chia: đây là xã mới được chọn mặc định (phần diện tích chính). */
  isDefault: boolean
}

export interface Candidate {
  /** Đơn vị đích (mới nếu Cũ ➔ Mới, cũ nếu Mới ➔ Cũ). */
  unit: AdminUnit
  /** Đơn vị nguồn đã khớp với chuỗi nhập. */
  from: AdminUnit
  address: string
  partial: boolean
  isDefault: boolean
  newWard: NewWard
}

export interface Suggestion {
  label: string
  /** Địa chỉ đã sửa – bấm vào để chuyển đổi lại. */
  address: string
}

export type ConversionResult =
  | { status: 'error'; message: string }
  | {
      status: 'not_found'
      message: string
      address: string
      tokens: string[]
      suggestions: Suggestion[]
    }
  | {
      status: 'found'
      direction: Direction
      tokens: string[]
      detailParts: string[]
      /** Phần hành chính đã nhận diện, đúng như người dùng gõ. */
      adminParts: string[]
      candidates: Candidate[]
      /** Xã mới liên quan (để hiển thị căn cứ), không trùng lặp. */
      newWards: NewWard[]
      warnings: string[]
    }

export interface MappingIndex {
  meta: AdminDataset['meta']
  stats: { oldWards: number; newWards: number; rows: number }
  newWards: NewWard[]
  /** Khóa "xã|huyện|tỉnh" cũ → các dòng mapping. */
  oldByWDP: Map<string, MappingRow[]>
  /** Khóa "xã|tỉnh" cũ (thiếu huyện). */
  oldByWP: Map<string, MappingRow[]>
  /** Khóa "xã|huyện" cũ (thiếu tỉnh). */
  oldByWD: Map<string, MappingRow[]>
  /** Khóa "xã|tỉnh" mới. */
  newByWP: Map<string, NewWard[]>
  /** Regex khớp các tên có gạch nối (trên chuỗi đã bỏ dấu, viết thường). */
  hyphenatedRe: RegExp | null
  /** Regex nhận diện tên tỉnh dính ở cuối chuỗi (trên chuỗi đã bỏ dấu, viết thường). */
  provinceTailRe: RegExp
}

// ---------------------------------------------------------------------------
// 1. Tách chuỗi
// ---------------------------------------------------------------------------

/** Ký tự giữ chỗ (vùng Private Use) để "giấu" các dấu không phải phân cách trước khi tách. */
const KEEP: Record<string, string> = { '.': '\uE000', '/': '\uE001', '-': '\uE002' }
const RESTORE = new Map(Object.entries(KEEP).map(([k, v]) => [v, k]))

/**
 * Mọi dấu được coi là phân cách: , ; . - – — / \ | và xuống dòng.
 * Sau khi tách, kết quả được ghép lại bằng " - " (OUTPUT_SEPARATOR).
 */
const SEPARATORS = /[,;.\-–—/\\|\n\r]+/

/**
 * Dấu chấm của viết tắt KHÔNG phải phân cách: "P. Phú Cường", "TP.HCM", "Q.1".
 * Chỉ áp dụng khi viết tắt đứng đầu một từ và theo sau là chữ/số.
 */
const ABBR_DOT = /(^|[^\p{L}\p{N}])(tp|tx|tt|đk|p|q|h|x|t)\.(?=\s*[\p{L}\p{N}])/giu

/** Dấu "/", ".", "-" nằm giữa hai chữ số là số nhà / ngõ: "12/3", "5-7", "1.5". */
const DIGIT_JOIN = /(\d)([/.-])(?=\d)/g

/** Bỏ dấu một ký tự, giữ nguyên độ dài chuỗi (để ánh xạ vị trí giữa bản gốc và bản bỏ dấu). */
function foldChar(c: string): string {
  if (c === 'đ' || c === 'Đ') return 'd'
  return c.normalize('NFD')[0].toLowerCase()
}

/**
 * Tách chuỗi địa chỉ thành các phần.
 *
 *   "Đội 5. thôn Phú Trạch/ X. Mễ Sở - H.Văn Giang ; Hưng Yên"
 *     → ["Đội 5", "thôn Phú Trạch", "X. Mễ Sở", "H.Văn Giang", "Hưng Yên"]
 *   "Số 12/3, P.Phú Mỹ, TX Phú Mỹ, Bà Rịa - Vũng Tàu"
 *     → ["Số 12/3", "P.Phú Mỹ", "TX Phú Mỹ", "Bà Rịa - Vũng Tàu"]
 */
export function tokenize(input: string, hyphenatedRe: RegExp | null = null): string[] {
  let s = input.normalize('NFC')

  // (a) Giấu dấu chấm sau viết tắt và dấu nối giữa hai chữ số.
  s = s.replace(ABBR_DOT, (_m, pre: string, abbr: string) => `${pre}${abbr}${KEEP['.']}`)
  s = s.replace(DIGIT_JOIN, (_m, d: string, sep: string) => `${d}${KEEP[sep]}`)

  // (b) Giấu gạch nối trong tên chính thức có dấu "-" (vd "Bà Rịa - Vũng Tàu").
  //     So khớp trên bản bỏ dấu cùng độ dài, rồi thay đúng vị trí trên bản gốc.
  if (hyphenatedRe) {
    const folded = Array.from({ length: s.length }, (_, i) => foldChar(s[i])).join('')
    const chars = s.split('')
    for (const match of folded.matchAll(hyphenatedRe)) {
      for (let i = match.index; i < match.index + match[0].length; i++) {
        if (chars[i] === '-') chars[i] = KEEP['-']
      }
    }
    s = chars.join('')
  }

  // (c) Tách theo mọi dấu phân cách, khôi phục ký tự đã giấu, gộp khoảng trắng.
  return s
    .split(SEPARATORS)
    .map((part) =>
      part
        .replace(/[\uE000-\uE002]/g, (c) => RESTORE.get(c) ?? c)
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((part) => part.length > 0)
}

/**
 * Tách dự phòng cho chuỗi KHÔNG có dấu phân cách:
 *   "thôn Phú Trạch xã Mễ Sở huyện Văn Giang tỉnh Hưng Yên"
 *     → ["thôn Phú Trạch", "xã Mễ Sở", "huyện Văn Giang", "tỉnh Hưng Yên"]
 * Cắt trước các từ khóa cấp hành chính. Chỉ dùng khi cách tách thông thường không tra được,
 * vì tên đường như "Xã Đàn" có thể bị cắt nhầm.
 */
const KEYWORD_SPLIT =
  /(?<!thị)\s+(?=(?:xã|phường|thị trấn|đặc khu|huyện|quận|thị xã|thành phố|tỉnh)\s|(?:tp|tx|tt|p|q|h|x|t)\.)/giu
/** Bản không dấu – chỉ dùng cho chuỗi gõ không dấu, tránh cắt nhầm "phường Quan Hoa". */
const KEYWORD_SPLIT_ASCII =
  /(?<!thi)\s+(?=(?:xa|phuong|thi tran|dac khu|huyen|quan|thi xa|thanh pho|tinh)\s|(?:tp|tx|tt|p|q|h|x|t)\.)/gi

/** Phần đầu chỉ còn là tiền tố tỉnh/thành → không tách ("thành phố | Thái Bình" là sai). */
const PROVINCE_PREFIX_ONLY = /^(thành phố|thủ đô|tỉnh|tp|thanh pho|thu do|tinh|t)\.?$/i

export function splitByKeywords(tokens: string[], provinceTailRe: RegExp | null = null): string[] {
  const out = tokens.flatMap((t) =>
    t
      .split(t === stripDiacritics(t) ? KEYWORD_SPLIT_ASCII : KEYWORD_SPLIT)
      .map((x) => x.trim())
      .filter(Boolean),
  )
  // Tên tỉnh dính liền cuối chuỗi, không có từ khóa: "quận Cầu Giấy Hà Nội" → "quận Cầu Giấy", "Hà Nội".
  const last = out.at(-1)
  if (provinceTailRe && last) {
    const folded = Array.from({ length: last.length }, (_, i) => foldChar(last[i])).join('')
    const match = provinceTailRe.exec(folded)
    const head = match ? last.slice(0, match.index).trim() : ''
    if (match && head && !PROVINCE_PREFIX_ONLY.test(head)) {
      out.splice(-1, 1, head, last.slice(match.index).trim())
    }
  }
  return out
}

export function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p).join(OUTPUT_SEPARATOR)
}

// ---------------------------------------------------------------------------
// 2. Chuẩn hóa tên đơn vị hành chính
// ---------------------------------------------------------------------------

export function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

/** Loại cấp hành chính suy ra từ tiền tố – dùng để loại các cách đọc vô lý. */
type Kind = 'ward' | 'district' | 'province' | 'city' | null

/** Tiền tố đầy đủ CÓ DẤU (cụm dài đứng trước). */
const FULL_PREFIX: Array<[RegExp, Kind]> = [
  [/^(thành phố|thủ đô)\s+/, 'city'],
  [/^(thị trấn|đặc khu|phường|xã)\s+/, 'ward'],
  [/^(thị xã|huyện|quận)\s+/, 'district'],
  [/^tỉnh\s+/, 'province'],
]
/** Viết tắt: bắt buộc có dấu chấm, riêng tp/tx/tt cho phép dấu cách ("TP HCM"). */
const ABBR_PREFIX: Array<[RegExp, Kind]> = [
  [/^tp(\.\s*|\s+)/, 'city'],
  [/^(tt|đk)(\.\s*|\s+)/, 'ward'],
  [/^(p|x)\.\s*/, 'ward'],
  [/^tx(\.\s*|\s+)/, 'district'],
  [/^(q|h)\.\s*/, 'district'],
  [/^t\.\s*/, 'province'],
]
/** Tiền tố KHÔNG DẤU – chỉ dùng khi cả chuỗi không dấu (tránh cắt nhầm "Quan Hóa", "Tịnh Biên"). */
const ASCII_PREFIX: Array<[RegExp, Kind]> = [
  [/^(thanh pho|thu do)\s+/, 'city'],
  [/^(thi tran|dac khu|phuong|xa)\s+/, 'ward'],
  [/^(thi xa|huyen|quan)\s+/, 'district'],
  [/^tinh\s+/, 'province'],
]
/** "Q1", "P12", "P01" → số. */
const NUMBERED_UNIT = /^(?:q|p)\s*(\d+)$/

/** Tên gọi tắt / tên cũ thông dụng (so khớp sau khi bỏ dấu). */
const ALIASES: Record<string, string> = {
  hcm: 'ho chi minh',
  tphcm: 'ho chi minh',
  'sai gon': 'ho chi minh',
  sg: 'ho chi minh',
  hn: 'ha noi',
  brvt: 'ba ria vung tau',
  'thua thien hue': 'hue',
  daklak: 'dak lak',
  daknong: 'dak nong',
}

/** Bóc tiền tố (một lần duy nhất), trả về phần còn lại và loại cấp hành chính. */
function splitPrefix(raw: string): { rest: string; kind: Kind } {
  const s = raw.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
  const isAscii = s === stripDiacritics(s)
  const tables = isAscii ? [FULL_PREFIX, ABBR_PREFIX, ASCII_PREFIX] : [FULL_PREFIX, ABBR_PREFIX]
  for (const table of tables) {
    for (const [re, kind] of table) {
      if (!re.test(s)) continue
      const rest = s.replace(re, '').trim()
      // Không để rỗng nếu người dùng chỉ gõ "phường".
      return rest ? { rest, kind } : { rest: s, kind: null }
    }
  }
  return { rest: s, kind: null }
}

/**
 * Chuẩn hóa tên ĐVHC thành khóa so khớp:
 *   "Xã Mễ Sở" → "me so"        "TP.HCM" → "ho chi minh"     "Phường 01" → "1"
 *   "Cư M’gar" → "cu mgar"       "Bà Rịa-Vũng Tàu" → "ba ria vung tau"
 */
export function normalizeName(raw: string): string {
  let s = stripDiacritics(splitPrefix(raw).rest)
  s = s
    .replace(/['‘’ʼ`]/g, '') // dấu nháy trong tên dân tộc: Ea H'Leo
    .replace(/[-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(NUMBERED_UNIT, '$1').replace(/^0+(\d)/, '$1')
  return ALIASES[s] ?? s
}

function kindOf(raw: string): Kind {
  return splitPrefix(raw).kind
}

const key = (...names: string[]) => names.map(normalizeName).join('|')

// ---------------------------------------------------------------------------
// 3. Dựng bảng tra
// ---------------------------------------------------------------------------

function push<K, V>(map: Map<K, V[]>, k: K, v: V) {
  const list = map.get(k)
  if (list) list.push(v)
  else map.set(k, [v])
}

/** Dựng toàn bộ bảng tra từ file JSON. Gọi một lần sau khi tải dữ liệu. */
export function buildIndex(data: AdminDataset): MappingIndex {
  const newWards: NewWard[] = data.nw.map(([p, ward, formedFrom]) => ({
    unit: { ward, district: null, province: data.np[p][0] },
    formedFrom,
    provinceFormedFrom: data.np[p][1],
    rows: [],
  }))

  const oldByWDP = new Map<string, MappingRow[]>()
  const oldByWP = new Map<string, MappingRow[]>()
  const oldByWD = new Map<string, MappingRow[]>()
  const newByWP = new Map<string, NewWard[]>()
  const hyphenated = new Set<string>()

  for (const [d, ward, target, flags] of data.m) {
    const [p, district] = data.od[d]
    const province = data.op[p]
    const row: MappingRow = {
      old: { ward, district, province },
      target: newWards[target],
      divided: (flags & 1) !== 0,
      isDefault: (flags & 2) !== 0,
    }
    newWards[target].rows.push(row)
    push(oldByWDP, key(ward, district, province), row)
    push(oldByWP, key(ward, province), row)
    push(oldByWD, key(ward, district), row)
    for (const name of [ward, district, province]) if (name.includes('-')) hyphenated.add(name)
  }
  for (const nw of newWards) {
    push(newByWP, key(nw.unit.ward, nw.unit.province), nw)
    for (const name of [nw.unit.ward, nw.unit.province]) if (name.includes('-')) hyphenated.add(name)
  }

  // Regex cho tên có gạch nối (dạng bỏ dấu, chữ thường).
  const patterns = [...hyphenated].map(namePattern)

  // Regex nhận diện tên tỉnh (cũ, mới, tên gọi tắt) dính ở cuối chuỗi, kèm tiền tố tùy chọn.
  const provinceNames = [...new Set([...data.op, ...data.np.map(([p]) => p)].map(namePattern))]
  const aliasNames = Object.keys(ALIASES).map((a) => a.replace(/ /g, '\\s+'))
  const provinceTailRe = new RegExp(
    `\\s(?:(?:tinh|thanh pho|thu do|tp)[.\\s]\\s*)?(?:${[...provinceNames, ...aliasNames].join('|')})$`,
  )

  return {
    meta: data.meta,
    stats: { oldWards: oldByWDP.size, newWards: newWards.length, rows: data.m.length },
    newWards,
    oldByWDP,
    oldByWP,
    oldByWD,
    newByWP,
    hyphenatedRe: patterns.length ? new RegExp(patterns.join('|'), 'g') : null,
    provinceTailRe,
  }
}

/** "Tỉnh Bà Rịa - Vũng Tàu" → "ba\s+ria\s*-\s*vung\s+tau" (bỏ tiền tố, bỏ dấu, chữ thường). */
function namePattern(name: string): string {
  return stripDiacritics(splitPrefix(name).rest)
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s*-\s*/g, '\\s*-\\s*')
    .replace(/ /g, '\\s+')
}

/** Tải file JSON tĩnh và dựng bảng tra (cache lại cho các lần gọi sau). */
let loading: Promise<MappingIndex> | null = null
export function loadIndex(): Promise<MappingIndex> {
  loading ??= fetch(`${import.meta.env.BASE_URL}data/admin-2025.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Không tải được dữ liệu (HTTP ${res.status})`)
      return res.json() as Promise<AdminDataset>
    })
    .then(buildIndex)
    .catch((err) => {
      loading = null // cho phép thử lại
      throw err
    })
  return loading
}

// ---------------------------------------------------------------------------
// 4. Chuyển đổi
// ---------------------------------------------------------------------------

/** Vai trò của từng phần tử ở đuôi chuỗi: xã, huyện, tỉnh, hoặc bỏ qua (null). */
type Role = 'w' | 'd' | 'p' | null

/** Loại tiền tố nào được phép cho từng vai trò (null = không có tiền tố, luôn hợp lệ). */
const ROLE_ACCEPTS: Record<'w' | 'd' | 'p', Kind[]> = {
  w: [null, 'ward'],
  d: [null, 'district', 'city'],
  p: [null, 'province', 'city'],
}

interface Reading {
  roles: Role[]
  table: (idx: MappingIndex) => Map<string, MappingRow[] | NewWard[]>
  warn?: (admin: string[]) => string
}

/**
 * Các cách đọc phần đuôi địa chỉ, thử theo thứ tự – cách đầu tiên tra được sẽ được dùng.
 * Cách đọc "lỏng" hơn (thiếu cấp, bỏ qua cấp) luôn kèm cảnh báo cho người dùng.
 */
const READINGS: Record<Direction, Reading[]> = {
  oldToNew: [
    { roles: ['w', 'd', 'p'], table: (i) => i.oldByWDP },
    {
      roles: ['w', null, 'p'],
      table: (i) => i.oldByWP,
      warn: ([, d]) => `Không khớp cấp huyện "${d}" – đã tra theo Xã/Phường + Tỉnh. Hãy kiểm tra lại kết quả.`,
    },
    {
      roles: ['w', 'p'],
      table: (i) => i.oldByWP,
      warn: () => 'Địa chỉ thiếu cấp Quận/Huyện – đã tra theo Xã/Phường + Tỉnh.',
    },
    {
      roles: ['w', 'd'],
      table: (i) => i.oldByWD,
      warn: () => 'Địa chỉ thiếu cấp Tỉnh/Thành phố – đã tra theo Xã/Phường + Quận/Huyện.',
    },
  ],
  newToOld: [
    { roles: ['w', 'p'], table: (i) => i.newByWP },
    {
      roles: ['w', null, 'p'],
      table: (i) => i.newByWP,
      warn: ([, d]) => `Đã bỏ qua "${d}" vì địa chỉ mới chỉ còn 2 cấp (Xã/Phường, Tỉnh/Thành phố).`,
    },
  ],
}

/**
 * Chuyển đổi một chuỗi địa chỉ.
 *
 * Ví dụ Cũ ➔ Mới:
 *   "Đội 5, thôn Phú Trạch, xã Mễ Sở, huyện Văn Giang, tỉnh Hưng Yên"
 *   tokens = ["Đội 5", "thôn Phú Trạch", "xã Mễ Sở", "huyện Văn Giang", "tỉnh Hưng Yên"]
 *   cách đọc [xã, huyện, tỉnh] → khóa "me so|van giang|hung yen" → Xã Mễ Sở, Tỉnh Hưng Yên
 *   → "Đội 5 - thôn Phú Trạch - Xã Mễ Sở - Tỉnh Hưng Yên"
 *
 * Ví dụ Mới ➔ Cũ (1 - nhiều):
 *   "Đội 5 - thôn Phú Trạch - xã Mễ Sở - Hưng Yên" → Xã Mễ Sở mới hợp thành từ 3 xã cũ
 *   → 3 kết quả (Mễ Sở, Thắng Lợi – huyện Văn Giang; Bình Minh – huyện Khoái Châu).
 */
export function convertAddress(input: string, direction: Direction, index: MappingIndex): ConversionResult {
  const tokens = tokenize(input, index.hyphenatedRe)
  if (tokens.length === 0) return { status: 'error', message: 'Vui lòng nhập địa chỉ cần chuyển đổi.' }

  // Thử với cách tách thông thường; nếu không được, thử tách theo từ khóa hành chính.
  const found = lookup(tokens, direction, index)
  if (found) return found
  const byKeyword = splitByKeywords(tokens, index.provinceTailRe)
  if (byKeyword.length !== tokens.length) {
    const retry = lookup(byKeyword, direction, index)
    if (retry) return retry
  }

  return {
    status: 'not_found',
    message:
      'Không tìm thấy đơn vị hành chính này trong dữ liệu. Hãy kiểm tra chính tả, thứ tự các cấp ' +
      '(Xã/Phường trước, Tỉnh/Thành phố sau cùng) hoặc chế độ chuyển đổi.',
    address: joinAddress(tokens),
    tokens,
    suggestions: suggest(tokens, direction, index),
  }
}

function lookup(tokens: string[], direction: Direction, index: MappingIndex): ConversionResult | null {
  for (const reading of READINGS[direction]) {
    const take = reading.roles.length
    if (tokens.length < take) continue

    const detailParts = tokens.slice(0, tokens.length - take)
    const adminParts = tokens.slice(tokens.length - take)

    // Loại cách đọc mâu thuẫn với tiền tố, vd "huyện Khoái Châu" không thể đóng vai Xã.
    const consistent = reading.roles.every((role, i) => role === null || ROLE_ACCEPTS[role].includes(kindOf(adminParts[i])))
    if (!consistent) continue

    const k = key(...adminParts.filter((_, i) => reading.roles[i] !== null))
    const hits = reading.table(index).get(k)
    if (!hits?.length) continue

    const candidates =
      direction === 'oldToNew'
        ? fromOldRows(hits as MappingRow[], detailParts)
        : fromNewWards(hits as NewWard[], detailParts)

    const warnings = reading.warn ? [reading.warn(adminParts)] : []
    // So khớp bỏ qua dấu, nên "Mễ Sọ" vẫn ra "Mễ Sở" – báo cho người dùng biết đã tự sửa.
    const typed = adminParts[0]
    const matched = candidates[0].from.ward
    if (typed !== stripDiacritics(typed) && splitPrefix(typed).rest !== splitPrefix(matched).rest) {
      warnings.push(`Đã hiểu "${typed}" là "${matched}".`)
    }

    return {
      status: 'found',
      direction,
      tokens,
      detailParts,
      adminParts,
      candidates,
      newWards: [...new Set(candidates.map((c) => c.newWard))],
      warnings,
    }
  }
  return null
}

/** Cũ ➔ Mới: mỗi dòng mapping là một xã mới khả dĩ (nhiều dòng nếu xã cũ bị chia). */
function fromOldRows(rows: MappingRow[], detail: string[]): Candidate[] {
  return rows
    .map((row) => ({
      unit: row.target.unit,
      from: row.old,
      address: buildAddress(detail, row.target.unit),
      partial: row.divided,
      isDefault: row.isDefault,
      newWard: row.target,
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
}

/** Mới ➔ Cũ: mỗi xã cũ hợp thành là một kết quả (quan hệ 1 - nhiều). */
function fromNewWards(wards: NewWard[], detail: string[]): Candidate[] {
  return wards.flatMap((nw) =>
    nw.rows
      .map((row) => ({
        unit: row.old,
        from: nw.unit,
        address: buildAddress(detail, row.old),
        partial: row.divided,
        isDefault: false,
        newWard: nw,
      }))
      .sort((a, b) => (a.unit.district ?? '').localeCompare(b.unit.district ?? '', 'vi')),
  )
}

function buildAddress(detail: string[], unit: AdminUnit): string {
  return joinAddress([...detail, unit.ward, unit.district, unit.province])
}

// ---------------------------------------------------------------------------
// 5. Gợi ý khi không tìm thấy
// ---------------------------------------------------------------------------

/** Khoảng cách Levenshtein (đủ nhanh cho vài trăm tên trong một tỉnh). */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/**
 * Nhận diện tỉnh ở phần tử cuối, rồi tìm xã có tên gần giống phần tử xã trong tỉnh đó.
 * Trả về tối đa 5 địa chỉ đã sửa để người dùng bấm chọn.
 */
function suggest(tokens: string[], direction: Direction, index: MappingIndex): Suggestion[] {
  if (tokens.length < 2) return []
  const provinceKey = normalizeName(tokens[tokens.length - 1])
  const units: AdminUnit[] =
    direction === 'oldToNew'
      ? [...index.oldByWDP.values()].map((rows) => rows[0].old)
      : index.newWards.map((nw) => nw.unit)
  const inProvince = units.filter((u) => normalizeName(u.province) === provinceKey)
  if (!inProvince.length) return []

  // Vị trí có thể là cấp Xã: địa chỉ cũ đủ 3 cấp (-3) hoặc thiếu huyện (-2); địa chỉ mới (-2).
  const positions = direction === 'oldToNew' ? [3, 2] : [2]
  const best = new Map<string, { s: Suggestion; dist: number }>()
  for (const levels of positions) {
    if (tokens.length < levels) continue
    const wardKey = normalizeName(tokens[tokens.length - levels])
    const detail = tokens.slice(0, tokens.length - levels)
    const maxDist = Math.max(1, Math.floor(wardKey.length / 4))
    for (const u of inProvince) {
      const name = normalizeName(u.ward)
      const dist = name === wardKey ? 0 : name.includes(wardKey) || wardKey.includes(name) ? 1 : editDistance(name, wardKey)
      if (dist > maxDist) continue
      const label = joinAddress([u.ward, u.district, u.province])
      const prev = best.get(label)
      if (!prev || dist < prev.dist) best.set(label, { s: { label, address: buildAddress(detail, u) }, dist })
    }
  }
  return [...best.values()]
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5)
    .map(({ s }) => s)
}
