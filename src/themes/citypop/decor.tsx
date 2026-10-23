// Decorations for the City pop look (docs/LOOKS.md, "Decor slots"). Optional components the shell renders
// while this look is active: Banner (top of the main column) and Headcount({ count, incoming }) in place
// of the rail's tally meter. Decor never covers content, never takes focus, respects reduced motion and
// carries no information that is not shown elsewhere.
//
// City pop: a pixel skyline at sunset (flat stepped sky bands, a striped sun, two rows of plum towers
// with lit windows) and an arcade score counter with one pixel per seat in the rail. All of it is
// aria-hidden and static, drawn on a 4px grid with crisp edges (styles in citypop.css).
import type { HeadcountDecorProps, LookDecor } from '../registry'

/** One skyline pixel. Everything below is drawn in multiples of it. */
const PX = 4
const W = 1280
const H = 64

/** Sky bands from the top, stepped like a 16-bit palette (no gradients). */
const SKY = [
  { y: 0, h: 16, fill: '#b9a4e6' },
  { y: 16, h: 12, fill: '#d6a6dc' },
  { y: 28, h: 12, fill: '#f3a6c8' },
  { y: 40, h: 12, fill: '#ffbe9c' },
  { y: 52, h: 12, fill: '#ffdca8' },
]

/** A small fixed-seed generator, so the skyline is the same on every render and every device. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

type Tower = { x: number; w: number; h: number }

/** The sun sits over the bay in the middle of the strip (so a phone, which shows the middle, sees it). */
const SUN_X = 640
const SUN_R = 36
const BAY = { from: SUN_X - SUN_R - 16, to: SUN_X + SUN_R + 16 }

function towers(seed: number, minH: number, maxH: number): Tower[] {
  const rnd = seeded(seed)
  const out: Tower[] = []
  let x = 0
  while (x < W) {
    const w = (4 + Math.floor(rnd() * 7)) * PX * 2
    const tall = (Math.floor(minH / PX) + Math.floor(rnd() * ((maxH - minH) / PX))) * PX
    // Over the bay the towers drop to low piers, so the sun stays in view.
    const h = x + w > BAY.from && x < BAY.to ? PX * 2 : tall
    out.push({ x, w, h })
    x += w + (rnd() < 0.3 ? PX * 2 : 0)
  }
  return out
}

const BACK = towers(7, 16, 36)
const FRONT = towers(42, 12, 48)

/** The sun as stacked 4px rows; the lower rows are cut by sky stripes that widen toward the horizon. */
function sunRows(cx: number, cy: number, r: number) {
  const rows: { x: number; y: number; w: number }[] = []
  for (let y = -r; y < 0; y += PX) {
    const mid = y + PX / 2
    const half = Math.round(Math.sqrt(r * r - mid * mid) / PX) * PX
    const fromBottom = -y / PX
    // Stripes: skip rows 2, 4, 5 and 7 counted up from the horizon, like a city pop record sleeve.
    if ([2, 4, 5, 7].includes(fromBottom)) continue
    rows.push({ x: cx - half, y: cy + y, w: half * 2 })
  }
  return rows
}

const SUN = sunRows(SUN_X, H - 8, SUN_R)

/** Lit windows: a 4px pane every other pixel on a tower, about a third of them on. */
function windows(list: Tower[], seed: number) {
  const rnd = seeded(seed)
  const out: { x: number; y: number }[] = []
  for (const t of list) {
    for (let y = H - t.h + PX * 2; y < H - PX * 2; y += PX * 2) {
      for (let x = t.x + PX; x < t.x + t.w - PX; x += PX * 2) {
        if (rnd() < 0.32) out.push({ x, y })
      }
    }
  }
  return out
}

const LIT = windows(FRONT, 99)

function Banner() {
  return (
    <div className="ft-cp-skyline" aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges" focusable="false">
        {SKY.map((b) => (
          <rect key={b.y} x={0} y={b.y} width={W} height={b.h} fill={b.fill} />
        ))}
        {SUN.map((r) => (
          <rect key={r.y} x={r.x} y={r.y} width={r.w} height={PX} fill={r.y < H - 28 ? '#ff4f86' : '#ff8f3d'} />
        ))}
        {BACK.map((t) => (
          <rect key={`b${t.x}`} x={t.x} y={H - t.h} width={t.w} height={t.h} fill="#8a5f9e" />
        ))}
        {FRONT.map((t) => (
          <rect key={`f${t.x}`} x={t.x} y={H - t.h} width={t.w} height={t.h} fill="#4b2d63" />
        ))}
        {LIT.map((w) => (
          <rect key={`${w.x},${w.y}`} x={w.x} y={w.y} width={PX} height={PX} fill="#ffd98a" />
        ))}
        <rect x={0} y={H - PX} width={W} height={PX} fill="#2a1b3d" />
      </svg>
    </div>
  )
}

/** The rail's headcount as an arcade score: a zero-padded counter and one pixel per seat out of 20. */
function Headcount({ count, incoming }: HeadcountDecorProps) {
  const slots = Math.max(20, count + incoming)
  return (
    <div className="ft-cp-hc" aria-hidden>
      <span className="ft-cp-hc__score">HC {String(Math.max(0, count)).padStart(3, '0')}</span>
      <span className="ft-cp-hc__seats">
        {Array.from({ length: slots }, (_, i) => (
          <span
            key={i}
            className={i < count ? 'ft-cp-hc__seat ft-cp-hc__seat--on' : i < count + incoming ? 'ft-cp-hc__seat ft-cp-hc__seat--incoming' : 'ft-cp-hc__seat'}
          />
        ))}
      </span>
    </div>
  )
}

export const decor: LookDecor = { Banner, Headcount }
