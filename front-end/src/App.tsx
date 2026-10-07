import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  loadIndex,
  convertAddress,
  joinAddress,
  OUTPUT_SEPARATOR,
  type Candidate,
  type ConversionResult,
  type Direction,
  type MappingIndex,
  type NewWard,
} from './lib/addressConverter'

const LABELS: Record<Direction, { from: string; to: string; toggle: string }> = {
  oldToNew: { from: 'Địa chỉ cũ', to: 'Địa chỉ mới', toggle: 'Cũ ➔ Mới' },
  newToOld: { from: 'Địa chỉ mới', to: 'Địa chỉ cũ', toggle: 'Mới ➔ Cũ' },
}

const PLACEHOLDERS: Record<Direction, string> = {
  oldToNew: 'Ví dụ: Đội 5, thôn Phú Trạch, xã Mễ Sở, huyện Văn Giang, tỉnh Hưng Yên',
  newToOld: 'Ví dụ: Đội 5 - thôn Phú Trạch - xã Mễ Sở - tỉnh Hưng Yên',
}

/** Địa chỉ mẫu (đã kiểm tra với dữ liệu thật), cố ý dùng nhiều kiểu dấu phân cách khác nhau. */
const EXAMPLES: Record<Direction, Array<{ label: string; value: string }>> = {
  oldToNew: [
    { label: 'Mễ Sở · Hưng Yên', value: 'Đội 5, thôn Phú Trạch, xã Mễ Sở, huyện Văn Giang, tỉnh Hưng Yên' },
    { label: 'P15 Tân Bình · bị chia', value: '59 Nguyễn Sỹ Sách / P15 / Tân Bình / TP.HCM' },
    { label: 'Phú Mỹ · Bà Rịa - Vũng Tàu', value: 'Số 12/3. P.Phú Mỹ. TX Phú Mỹ. Bà Rịa - Vũng Tàu' },
  ],
  newToOld: [
    { label: 'xã Mễ Sở', value: 'Đội 5 - thôn Phú Trạch - xã Mễ Sở - tỉnh Hưng Yên' },
    { label: 'phường Bến Thành', value: 'Số 5, phường Bến Thành, TP.HCM' },
    { label: 'Đặc khu Phú Quốc', value: 'Đặc khu Phú Quốc, An Giang' },
  ],
}

/** Số kết quả hiển thị trước khi bấm "Xem thêm" (danh sách Mới ➔ Cũ có thể dài 10–20 dòng). */
const INITIAL_VISIBLE = 6

const other = (d: Direction): Direction => (d === 'oldToNew' ? 'newToOld' : 'oldToNew')

export default function App() {
  // Dữ liệu (~140 KB gzip) tải một lần từ file tĩnh, sau đó mọi tra cứu chạy trong bộ nhớ.
  const [index, setIndex] = useState<MappingIndex | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [direction, setDirection] = useState<Direction>('oldToNew')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<ConversionResult | null>(null)
  /** Chuỗi không khớp chiều hiện tại nhưng khớp chiều ngược lại. */
  const [suggestSwitch, setSuggestSwitch] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadIndex().then(setIndex, (err: Error) => setLoadError(err.message))
  }, [])

  function run(text: string, dir: Direction) {
    if (!index) return
    const r = convertAddress(text, dir, index)
    setResult(r)
    setSuggestSwitch(
      r.status !== 'found' && text.trim() !== '' && convertAddress(text, other(dir), index).status === 'found',
    )
    // Trên điện thoại, kết quả nằm dưới màn hình – cuộn tới cho người dùng thấy ngay.
    if (window.matchMedia('(max-width: 639px)').matches) {
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  function changeDirection(dir: Direction) {
    if (dir === direction) return
    setDirection(dir)
    setResult(null)
    setSuggestSwitch(false)
  }

  /** Đổi chiều. Nếu đang có đúng 1 kết quả thì đưa lên ô nhập và chuyển ngược lại ngay. */
  function swap() {
    const next = other(direction)
    setDirection(next)
    if (result?.status === 'found' && result.candidates.length === 1) {
      const text = result.candidates[0].address
      setInput(text)
      run(text, next)
    } else {
      setResult(null)
      setSuggestSwitch(false)
    }
  }

  function clear() {
    setInput('')
    setResult(null)
    setSuggestSwitch(false)
    inputRef.current?.focus()
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setInput(text.trim())
    } catch {
      inputRef.current?.focus() // trình duyệt từ chối quyền – để người dùng tự dán
    }
  }

  function apply(text: string, dir: Direction = direction) {
    setDirection(dir)
    setInput(text)
    run(text, dir)
  }

  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

  return (
    <div className="min-h-svh bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-200">
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:pt-14">
        <header className="mb-5 sm:mb-8">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <span className={`size-1.5 rounded-full ${index ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
            {index
              ? `${index.stats.newWards.toLocaleString('vi-VN')} xã/phường mới · ${index.stats.oldWards.toLocaleString('vi-VN')} xã/phường cũ`
              : 'Đang tải dữ liệu…'}
          </span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:mt-4 sm:text-4xl dark:text-white">
            Chuyển đổi địa chỉ hành chính
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 sm:mt-2 sm:text-base dark:text-slate-400">
            Đổi địa chỉ theo đơn vị hành chính cũ (3 cấp) sang mới (2 cấp, từ 01/07/2025) và ngược lại. Chạy hoàn
            toàn trên trình duyệt.
          </p>
        </header>

        {loadError && (
          <Notice tone="error" title="Không tải được dữ liệu">
            {loadError}.{' '}
            <button type="button" className="font-medium underline" onClick={() => window.location.reload()}>
              Tải lại trang
            </button>
          </Notice>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-slate-800 dark:bg-slate-900">
          {/* Chọn chiều – trên điện thoại chiếm toàn bộ chiều ngang */}
          <div className="flex items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Chiều chuyển đổi"
              className="grid flex-1 grid-cols-2 rounded-xl bg-slate-100 p-1 sm:inline-grid sm:flex-none dark:bg-slate-800"
            >
              {(['oldToNew', 'newToOld'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={direction === d}
                  onClick={() => changeDirection(d)}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition sm:py-1.5 ${
                    direction === d
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {LABELS[d].toggle}
                </button>
              ))}
            </div>
            <IconButton onClick={swap} label="Đổi chiều chuyển đổi" className="size-11 sm:size-9">
              <SwapIcon />
            </IconButton>
          </div>

          {/* Ô nhập */}
          <div className="mt-4 flex items-end justify-between gap-2 sm:mt-5">
            <label htmlFor="address" className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {LABELS[direction].from}
            </label>
            {canPaste && (
              <button
                type="button"
                onClick={paste}
                className="-my-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
              >
                <PasteIcon /> Dán
              </button>
            )}
          </div>
          <div className="relative mt-1.5">
            <textarea
              id="address"
              ref={inputRef}
              rows={3}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  run(input, direction)
                }
              }}
              placeholder={PLACEHOLDERS[direction]}
              autoComplete="street-address"
              spellCheck={false}
              // text-base (16px) để Safari trên iPhone không tự phóng to khi nhập.
              className="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 pr-11 text-base text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500"
            />
            {input && (
              <IconButton onClick={clear} label="Xóa nội dung" className="absolute top-1.5 right-1.5 size-9 border-0">
                <XIcon />
              </IconButton>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Phân tách các cấp bằng dấu <Kbd>,</Kbd> <Kbd>.</Kbd> <Kbd>-</Kbd> <Kbd>/</Kbd> <Kbd>;</Kbd> đều được – kết
            quả luôn dùng dấu <Kbd>{OUTPUT_SEPARATOR.trim()}</Kbd>. Chấp nhận viết tắt (P., Q., TP., TX.) và gõ không
            dấu.
          </p>

          {/* Ví dụ: cuộn ngang trên điện thoại, xuống dòng trên màn hình lớn */}
          <div className="-mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
            <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">Thử:</span>
            {EXAMPLES[direction].map((ex) => (
              <button
                key={ex.value}
                type="button"
                onClick={() => apply(ex.value)}
                disabled={!index}
                className="shrink-0 rounded-full border border-slate-200 px-3 py-1.5 text-xs whitespace-nowrap text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300"
              >
                {ex.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => run(input, direction)}
            disabled={!index}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:ring-4 focus-visible:ring-indigo-500/30 focus-visible:outline-none active:bg-indigo-700 disabled:cursor-wait disabled:opacity-60 sm:mt-5 sm:w-auto sm:py-3 sm:text-sm"
          >
            {index ? 'Chuyển đổi' : 'Đang tải dữ liệu…'}
            {index && <ArrowIcon />}
          </button>
          <p className="mt-2 hidden text-xs text-slate-400 sm:block">
            Mẹo: nhấn <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> để chuyển đổi nhanh.
          </p>
        </section>

        {/* Kết quả */}
        <div ref={resultRef} aria-live="polite" className="mt-5 scroll-mt-4 sm:mt-6">
          {result && (
            <ResultView
              key={JSON.stringify(result.status === 'error' ? result.message : result.tokens) + direction}
              result={result}
              direction={direction}
              suggestSwitch={suggestSwitch}
              onSwitch={() => apply(input, other(direction))}
              onApply={(text) => apply(text)}
              meta={index?.meta}
            />
          )}
        </div>

        {index && <DataPanel index={index} />}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Khung kết quả
// ---------------------------------------------------------------------------

function ResultView({
  result,
  direction,
  suggestSwitch,
  onSwitch,
  onApply,
  meta,
}: {
  result: ConversionResult
  direction: Direction
  suggestSwitch: boolean
  onSwitch: () => void
  onApply: (text: string) => void
  meta?: MappingIndex['meta']
}) {
  const [showAll, setShowAll] = useState(false)

  const switchHint = suggestSwitch && (
    <button
      type="button"
      onClick={onSwitch}
      className="mt-3 block text-left text-sm font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-600 dark:text-indigo-300"
    >
      Có vẻ đây là {LABELS[other(direction)].from.toLowerCase()} → chuyển sang {LABELS[other(direction)].toggle}
    </button>
  )

  if (result.status === 'error') {
    return (
      <Notice tone="error" title="Chưa thể chuyển đổi">
        {result.message}
        {switchHint}
      </Notice>
    )
  }

  if (result.status === 'not_found') {
    return (
      <div className="space-y-3 sm:space-y-4">
        <Notice tone="warn" title="Không tìm thấy trong dữ liệu">
          {result.message}
          {switchHint}
        </Notice>
        {!suggestSwitch && result.suggestions.length > 0 && (
          <Card>
            <CardLabel>Có phải bạn muốn tìm</CardLabel>
            <ul className="mt-2 space-y-1">
              {result.suggestions.map((s) => (
                <li key={s.label}>
                  <button
                    type="button"
                    onClick={() => onApply(s.address)}
                    className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-indigo-700 transition hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card>
          <CardLabel>Địa chỉ (giữ nguyên, đã chuẩn hóa dấu phân cách)</CardLabel>
          <AddressRow address={result.address} />
        </Card>
      </div>
    )
  }

  const { candidates, tokens, detailParts, adminParts, warnings, newWards } = result
  const many = candidates.length > 1
  const visible = showAll ? candidates : candidates.slice(0, INITIAL_VISIBLE)
  // Khi tra thiếu cấp, có thể khớp nhiều xã cùng tên ở các huyện khác nhau → hiện rõ nguồn.
  const ambiguousSource =
    direction === 'oldToNew' && new Set(candidates.map((c) => joinAddress([c.from.ward, c.from.district]))).size > 1

  return (
    <div className="space-y-3 sm:space-y-4">
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <CardLabel>{LABELS[direction].to}</CardLabel>
          {many && <span className="text-xs text-slate-500 dark:text-slate-400">{candidates.length} kết quả</span>}
        </div>
        {many && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {direction === 'newToOld'
              ? `Đơn vị mới được hợp nhất từ ${candidates.length} đơn vị cũ. Chọn đơn vị đúng với vị trí thực tế.`
              : ambiguousSource
                ? 'Có nhiều xã/phường cũ trùng tên. Chọn kết quả có huyện đúng với địa chỉ của bạn.'
                : `Đơn vị cũ đã được chia cho ${candidates.length} đơn vị mới. Kết quả "mặc định" ứng với phần diện tích chính; hãy xác định theo vị trí thực tế.`}
          </p>
        )}
        <ul className={many ? 'mt-2 divide-y divide-slate-100 dark:divide-slate-800' : 'mt-1.5'}>
          {visible.map((c) => (
            <li key={`${c.address}|${joinAddress([c.from.ward, c.from.district])}`} className={many ? 'py-2.5' : ''}>
              <AddressRow
                address={c.address}
                large={!many}
                badges={<Badges c={c} direction={direction} />}
                sub={ambiguousSource ? `từ ${joinAddress([c.from.ward, c.from.district])}` : undefined}
              />
            </li>
          ))}
        </ul>
        {candidates.length > INITIAL_VISIBLE && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-1 w-full rounded-lg py-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
          >
            {showAll ? 'Thu gọn' : `Xem thêm ${candidates.length - INITIAL_VISIBLE} kết quả`}
          </button>
        )}
        {warnings.map((w) => (
          <p
            key={w}
            className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {w}
          </p>
        ))}
      </Card>

      <Card>
        <CardLabel>Phân tích chuỗi nhập</CardLabel>
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[9.5rem_1fr]">
          <dt className="text-slate-500 dark:text-slate-400">Đã tách thành</dt>
          <dd className="mb-1.5 sm:mb-0">{tokens.length} phần</dd>
          <dt className="text-slate-500 dark:text-slate-400">Chi tiết (giữ nguyên)</dt>
          <dd className="mb-1.5 sm:mb-0">
            {detailParts.length ? <Chips items={detailParts} /> : <span className="text-slate-400">—</span>}
          </dd>
          <dt className="text-slate-500 dark:text-slate-400">Cấp hành chính</dt>
          <dd>
            <Chips items={adminParts} accent />
          </dd>
        </dl>
      </Card>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          Căn cứ thay đổi
        </h2>
        {newWards.map((nw, i) => (
          <BasisCard key={joinAddress([nw.unit.ward, nw.unit.province])} ward={nw} meta={meta} open={i === 0} />
        ))}
      </section>
    </div>
  )
}

function Badges({ c, direction }: { c: Candidate; direction: Direction }) {
  return (
    <>
      {direction === 'oldToNew' && c.isDefault && <Badge tone="indigo">mặc định</Badge>}
      {c.partial && (
        <Badge tone="amber" title="Chỉ một phần diện tích/dân số của xã cũ thuộc xã mới này">
          một phần
        </Badge>
      )}
    </>
  )
}

/** Thông tin căn cứ của một xã/phường mới – thu gọn được để không chiếm chỗ trên điện thoại. */
function BasisCard({ ward, meta, open }: { ward: NewWard; meta?: MappingIndex['meta']; open: boolean }) {
  return (
    <details
      open={open}
      className="group rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-slate-900 sm:px-5 dark:text-white [&::-webkit-details-marker]:hidden">
        {joinAddress([ward.unit.ward, ward.unit.province])}
        <span className="text-slate-400 transition group-open:rotate-180">▾</span>
      </summary>
      <dl className="grid gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-3 text-sm sm:grid-cols-[9.5rem_1fr] sm:px-5 dark:border-slate-800">
        <dt className="text-slate-500 dark:text-slate-400">Hình thành từ</dt>
        <dd className="mb-2 sm:mb-0">{ward.formedFrom || '—'}</dd>
        {ward.provinceFormedFrom && (
          <>
            <dt className="text-slate-500 dark:text-slate-400">Tỉnh hợp nhất từ</dt>
            <dd className="mb-2 sm:mb-0">{ward.provinceFormedFrom}</dd>
          </>
        )}
        {meta && (
          <>
            <dt className="text-slate-500 dark:text-slate-400">Hiệu lực</dt>
            <dd className="mb-2 sm:mb-0">{formatDate(meta.effectiveDate)}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Văn bản</dt>
            <dd>{meta.resolution}</dd>
          </>
        )}
      </dl>
    </details>
  )
}

/** Một dòng địa chỉ + nút sao chép (chỉ icon trên điện thoại để nhường chỗ cho chữ). */
function AddressRow({
  address,
  badges,
  sub,
  large,
}: {
  address: string
  badges?: ReactNode
  sub?: string
  large?: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p
          className={`break-words text-slate-900 dark:text-white ${large ? 'text-base font-medium sm:text-lg' : 'text-[15px] sm:text-base'}`}
        >
          {address}
        </p>
        {(badges || sub) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            {badges}
            {sub && <span>{sub}</span>}
          </div>
        )}
      </div>
      <CopyButton text={address} />
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  async function copy() {
    if (await copyToClipboard(text)) {
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Đã sao chép' : 'Sao chép địa chỉ'}
      title="Sao chép"
      className={`inline-flex size-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition sm:h-8 sm:w-auto sm:px-2.5 ${
        copied
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300'
          : 'border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span className="hidden sm:inline">{copied ? 'Đã chép' : 'Sao chép'}</span>
    </button>
  )
}

/** Clipboard API cần HTTPS/localhost; ngoài ra dùng cách cũ với textarea ẩn. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

// ---------------------------------------------------------------------------
// Nguồn dữ liệu
// ---------------------------------------------------------------------------

function DataPanel({ index }: { index: MappingIndex }) {
  const { meta, stats } = index
  return (
    <details className="group mt-8 rounded-2xl border border-slate-200 bg-white text-sm sm:mt-10 dark:border-slate-800 dark:bg-slate-900">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-medium text-slate-700 sm:px-6 dark:text-slate-300 [&::-webkit-details-marker]:hidden">
        Nguồn dữ liệu
        <span className="text-slate-400 transition group-open:rotate-180">▾</span>
      </summary>
      <dl className="grid gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-4 sm:grid-cols-[9.5rem_1fr] sm:px-6 dark:border-slate-800">
        <dt className="text-slate-500 dark:text-slate-400">Quy mô</dt>
        <dd className="mb-2 sm:mb-0">
          {stats.rows.toLocaleString('vi-VN')} dòng mapping: {stats.oldWards.toLocaleString('vi-VN')} xã/phường cũ (63
          tỉnh) → {stats.newWards.toLocaleString('vi-VN')} xã/phường mới (34 tỉnh)
        </dd>
        <dt className="text-slate-500 dark:text-slate-400">Nguồn gốc</dt>
        <dd className="mb-2 sm:mb-0">{meta.origin}</dd>
        <dt className="text-slate-500 dark:text-slate-400">Bộ dữ liệu</dt>
        <dd className="mb-2 break-all sm:mb-0">
          <a href={meta.source} target="_blank" rel="noreferrer" className="text-indigo-700 underline dark:text-indigo-300">
            {meta.source.replace('https://', '')}
          </a>{' '}
          ({meta.license}, commit {meta.commit.slice(0, 7)})
        </dd>
        <dt className="text-slate-500 dark:text-slate-400">Văn bản</dt>
        <dd>{meta.resolution}</dd>
      </dl>
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-6 dark:border-slate-800 dark:text-slate-400">
        Kết quả mang tính tham khảo. Với xã/phường bị chia cho nhiều đơn vị mới, cần đối chiếu vị trí thực tế hoặc
        tra cứu tại sapnhap.bando.com.vn.
      </p>
    </details>
  )
}

// ---------------------------------------------------------------------------
// UI nhỏ dùng chung
// ---------------------------------------------------------------------------

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900">
      {children}
    </section>
  )
}

function CardLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">{children}</h2>
  )
}

function Notice({ tone, title, children }: { tone: 'error' | 'warn'; title: string; children: ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
      : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`mb-4 rounded-2xl border p-4 text-sm last:mb-0 sm:p-5 ${styles}`}
    >
      <p className="font-semibold">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function Badge({ tone, title, children }: { tone: 'amber' | 'indigo'; title?: string; children: ReactNode }) {
  const styles =
    tone === 'amber'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
      : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300'
  return (
    <span title={title} className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  )
}

function Chips({ items, accent }: { items: string[]; accent?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={i}
          className={`rounded-md px-2 py-0.5 ${
            accent
              ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-200'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
          }`}
        >
          {item}
        </span>
      ))}
    </span>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 px-1 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:text-slate-300">
      {children}
    </kbd>
  )
}

function IconButton({
  onClick,
  label,
  className = '',
  children,
}: {
  onClick: () => void
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white ${className}`}
    >
      {children}
    </button>
  )
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Icon SVG nội tuyến (không cần thư viện ngoài)
const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}
const SwapIcon = () => (
  <svg {...iconProps}>
    <path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
  </svg>
)
const XIcon = () => (
  <svg {...iconProps}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)
const ArrowIcon = () => (
  <svg {...iconProps}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)
const CopyIcon = () => (
  <svg {...iconProps} width={15} height={15}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
)
const CheckIcon = () => (
  <svg {...iconProps} width={15} height={15}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const PasteIcon = () => (
  <svg {...iconProps} width={14} height={14}>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  </svg>
)
