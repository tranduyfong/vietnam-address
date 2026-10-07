/**
 * Sinh file dữ liệu public/data/admin-2025.json từ bộ dữ liệu mở vietnamadminunits (MIT).
 *
 *   npm run data
 *
 * Nguồn gốc dữ liệu (theo repo trên):
 *  - Bảng mapping 63 tỉnh (3 cấp) → 34 tỉnh (2 cấp): đối chiếu từ sapnhap.bando.com.vn
 *    và danhmuchanhchinh.gso.gov.vn.
 *  - Mô tả "hình thành từ" của từng xã/phường mới: sapnhap.bando.com.vn.
 *
 * Chỉ chạy lúc phát triển. Ứng dụng web không gọi mạng – nó đọc file JSON đã sinh sẵn.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'tranngocminhhieu/vietnamadminunits'
const COMMIT = '7fac8c45805aad9916b17237c54baf4502303b93' // cố định để kết quả tái lập được
const RAW = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/data`
const FILES = {
  mapping: `${RAW}/processed/convert_legacy_2025_with_location_and_default_ward.csv`,
  newWards: `${RAW}/processed/2025_34-province-3221-ward_with_location.csv`,
  bandoWards: `${RAW}/raw/sapnhap.bando.com.vn_ward_2025-07-17.csv`,
  bandoProvinces: `${RAW}/raw/sapnhap.bando.com.vn_province_2025-07-17.csv`,
}
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/admin-2025.json')

/** CSV parser tối giản: hỗ trợ trường trong ngoặc kép và "" thoát. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n') row.push(field.replace(/\r$/, '')), rows.push(row), (row = []), (field = '')
    else field += c
  }
  if (field || row.length) row.push(field), rows.push(row)
  const header = rows.shift()
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i].trim()])))
}

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return parseCsv((await res.text()).normalize('NFC'))
}

/**
 * Khóa so khớp giữa các nguồn: chữ thường, bỏ dấu, bỏ dấu nháy ("Cư M'gar" = "Cư M’gar"),
 * bỏ tiền tố tỉnh.
 */
const key = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/['‘’ʼ`]/g, '')
    .replace(/^(thu do|thanh pho|tinh)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

/** Bỏ loại đơn vị ở đầu tên xã: "phuong viet hoa" → "viet hoa". */
const bare = (k) => k.replace(/^(xa|phuong|dac khu|thi tran)\s+/, '')

const [mapping, newWards, bandoWards, bandoProvinces] = await Promise.all(
  Object.values(FILES).map(download),
)

// --- Mô tả "trước sáp nhập" từ bando, tra theo (tỉnh, loại + tên xã) ---
const provinceFormedFrom = new Map(bandoProvinces.map((p) => [key(p.tentinh), p.truocsapnhap]))
const wardFormedFrom = new Map(
  bandoWards.map((w) => [`${key(w.tentinh)}|${key(`${w.loai} ${w.tenhc}`)}`, w.truocsapnhap]),
)
// Dự phòng khi hai nguồn ghi khác loại (bando "xã Việt Hòa" ↔ GSO "Phường Việt Hòa"):
// tra theo tên trần, chỉ dùng khi tên đó là duy nhất trong tỉnh.
const bareCount = new Map()
const wardFormedFromBare = new Map()
for (const w of bandoWards) {
  const k = `${key(w.tentinh)}|${bare(key(w.tenhc))}`
  bareCount.set(k, (bareCount.get(k) ?? 0) + 1)
  wardFormedFromBare.set(k, w.truocsapnhap)
}
const lookupWardNote = (province, ward) => {
  const exact = wardFormedFrom.get(`${key(province)}|${key(ward)}`)
  if (exact !== undefined) return exact
  const k = `${key(province)}|${bare(key(ward))}`
  return bareCount.get(k) === 1 ? wardFormedFromBare.get(k) : undefined
}

// --- Tỉnh mới (34) và xã mới (3.321) ---
const np = [] // [tên tỉnh, mô tả trước sáp nhập]
const npIndex = new Map()
const nw = [] // [chỉ số tỉnh mới, tên xã, mô tả hình thành]
const nwIndex = new Map()
let missingNotes = 0
for (const w of newWards) {
  if (!npIndex.has(w.province)) {
    npIndex.set(w.province, np.length)
    const formed = provinceFormedFrom.get(key(w.provinceShort)) ?? ''
    np.push([w.province, formed === 'không sáp nhập' ? '' : formed])
  }
  const note = lookupWardNote(w.provinceShort, w.ward)
  if (note === undefined) missingNotes++
  nwIndex.set(`${w.province}|${w.ward}`, nw.length)
  nw.push([npIndex.get(w.province), w.ward, note ?? ''])
}

// --- Tỉnh cũ (63), huyện cũ, và các dòng mapping xã cũ → xã mới ---
const op = []
const opIndex = new Map()
const od = [] // [chỉ số tỉnh cũ, tên huyện]
const odIndex = new Map()
const m = [] // [chỉ số huyện cũ, tên xã cũ, chỉ số xã mới, cờ]
let unknownNew = 0
for (const r of mapping) {
  if (!opIndex.has(r.province)) opIndex.set(r.province, op.push(r.province) - 1)
  const dKey = `${r.province}|${r.district}`
  if (!odIndex.has(dKey)) odIndex.set(dKey, od.push([opIndex.get(r.province), r.district]) - 1)

  const target = nwIndex.get(`${r.newProvince}|${r.newWard}`)
  if (target === undefined) {
    unknownNew++
    continue
  }
  // Cờ: 1 = xã cũ bị chia cho nhiều xã mới; 2 = xã mới mặc định khi bị chia.
  const flags = (r.isDividedWard === 'True' ? 1 : 0) | (r.isDefaultNewWard === 'True' ? 2 : 0)
  m.push([odIndex.get(dKey), r.ward, target, flags])
}

const data = {
  meta: {
    source: `https://github.com/${REPO}`,
    commit: COMMIT,
    license: 'MIT',
    origin: 'sapnhap.bando.com.vn, danhmuchanhchinh.gso.gov.vn',
    effectiveDate: '2025-07-01',
    resolution: 'Nghị quyết số 202/2025/QH15 (sắp xếp ĐVHC cấp tỉnh) và các Nghị quyết của UBTVQH về sắp xếp ĐVHC cấp xã năm 2025',
    generatedAt: new Date().toISOString().slice(0, 10),
  },
  np,
  nw,
  op,
  od,
  m,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(data))

const hyphenated = [...new Set([...op, ...od.map((d) => d[1]), ...m.map((r) => r[1]), ...np.map((p) => p[0]), ...nw.map((w) => w[1])].filter((s) => s.includes('-')))]
console.log({
  newProvinces: np.length,
  newWards: nw.length,
  oldProvinces: op.length,
  oldDistricts: od.length,
  mappingRows: m.length,
  skippedRowsWithUnknownNewWard: unknownNew,
  newWardsWithoutBandoNote: missingNotes,
  hyphenatedNames: hyphenated,
})
console.log('Wrote', OUT)
