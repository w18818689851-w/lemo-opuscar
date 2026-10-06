// "Coffea arabica, Plate I" — a trade-gallery plate in the copperplate engraving style.
// New timeline, new camera route, new event table, new subtitles; only the medium (engine call order) is shared
// with film.js. All words and data come from content_coffee.json.
//
// This module also carries the consistency contract: LINES (subtitle windows + anchors) and probeAt(t) (what is
// actually on the plate at t). Both are driven by the same tables that drive the render, so words, meaning and
// picture cannot drift apart.
import * as B from './engine/burin.js';
import * as plate from './engine/plate.js';
import { drawSheet, paperTexture, borderInk, engraveText, writeScript, wrapLines, roundelFrame, PAL, FONTS, measure } from './engine/plate.js';
import { Wash } from './engine/wash.js';
import * as Cu from './engine/copper.js';
import { clamp, eio, ss } from '/core/lib.js';
import { langOf, isCJK } from '/core/lang/lang.mjs';

// The plate is authored for one frame — NATIVE, the 1920×1080 the design was drawn on. makeFilm re-derives the
// whole layout for whatever frame it is given (main.js hands it the viewport; 9:16 is the product default):
//   fx, fy  map a position across/up the frame, so the sheet always fills it whatever its shape;
//   S       scales every SIZE (radii, type, rules, leads) by the tighter axis — the ink keeps its weight and the
//           two label columns still fit between the roundels and the plate edges on a narrow, tall frame.
// The figure is the one exception: S would tie it to the tighter axis too, but what it has is a rectangle of room
// (see figScale), and on a tall frame the label columns leave that rectangle far wider than S alone would allow.
// At 1920×1080 fx = fy = S = 1, so every expression below reduces to exactly the number it replaced: the 16:9
// picture is byte-for-byte what it always was. Nothing here may be evaluated at module load — it needs W and H.
export const NATIVE = { W: 1920, H: 1080 }, BEAT = 0.625;
function layout(W, H) {
  const fx = W / NATIVE.W, fy = H / NATIVE.H, S = Math.min(fx, fy);
  const PLATE = [70 * fx, 44 * fy, 1850 * fx, 1036 * fy], BORDER = [100 * fx, 72 * fy, 1820 * fx, 1008 * fy];
  // the four roundel slots: one to a corner, clear of the border above and the chart strip below, so the margin
  // label that follows each roundel can sit inboard of it. Each label column blocks only the band it stands in,
  // so it is the figure's room — not a single ratio — that decides how large the plant may be drawn (figScale).
  const SLOTS = { UL: [215 * fx, 190 * fy], LL: [215 * fx, 672 * fy], LR: [1705 * fx, 672 * fy], UR: [1705 * fx, 190 * fy] };
  const SLOT_ORDER = ['UL', 'LL', 'LR', 'UR'], RR = 84 * S;
  const STRIP = [150 * fx, 782 * fy, 1770 * fx, 952 * fy];          // the sea-chart band: x0, y0, x1, y1
  const NOTE = { size: 27 * S, width: 320 * S, lead: 1.08 };        // one size for every note; long notes wrap, never shrink
  const LEAD = 19 * S, GAPL = 23 * S, LEADN = NOTE.size * NOTE.lead, AIR = 20 * S, DESC = 10 * S;
  // the three lines of a margin label, as baselines measured off the slot centre: below the upper roundels,
  // above the lower ones. Every line clears the roundel circle by AIR; the note block grows away from the roundel.
  function labAnchor(ly, above, nl = 1) {
    if (!above) { const name = ly + RR + 13 * S + AIR; const latin = name + LEAD; return { name, latin, note0: latin + GAPL }; }
    const note0 = ly - RR - AIR - DESC - (nl - 1) * LEADN; const latin = note0 - GAPL; return { name: latin - LEAD, latin, note0 };
  }
  // the four label rectangles, as polygons: the leader router must go round them, or a leader would be cut across a label
  const labelRect = (sx, sy, nl = 3) => {
    const onLeft = sx < W / 2, above = sy > H / 2, cx = onLeft ? sx + RR + 26 * S + NOTE.width / 2 : sx - RR - 26 * S - NOTE.width / 2;
    const a = labAnchor(sy, above, nl), x0 = cx - NOTE.width / 2, x1 = cx + NOTE.width / 2;
    const y0 = a.name - 13 * S, y1 = a.note0 + (nl - 1) * LEADN + DESC;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  };
  const LAB_BOX = SLOT_ORDER.map(k => labelRect(...SLOTS[k]));
  // the figure: centred on the plate's middle band (the design puts it at 470 of 1080, i.e. just above
  // the chart strip — keep that fraction of the height, not the pixels). Its size is no longer a scalar
  // multiple of S: what it has to fit is a rectangle, and figScale() below works that out from these walls.
  const CX = W / 2, CY = 470 * fy;
  // the foot of the title block and the head of the chart strip: the figure's room, top and bottom
  const TITLE_BOT = 200 * fy;
  return { W, H, fx, fy, S, PLATE, BORDER, SLOTS, SLOT_ORDER, RR, STRIP, NOTE, LEAD, GAPL, LEADN, AIR, DESC, labAnchor, labelRect, LAB_BOX, CX, CY, TITLE_BOT };
}
const seg = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------- the figure's room
// S is the wrong measure of how large the plant may be drawn. S is set by the tighter axis, but the room
// the plant actually has is a rectangle: the two margin-label columns block the band they stand in and
// nothing else, and the engraved border, the title block above and the chart strip below close it off.
// On a tall frame the columns drift clear of the plant's own band (their y follows fy, the plant's size
// follows S), so the only thing left holding the plant in is the border — and that is exactly the room
// the old rule was throwing away. So: fit the plant to the rectangle, do not multiply it by S.
//   box      = the plant's own extent at s = 1 about its anchor: half-width hw, up above it, dn below.
//   figScale = the largest uniform s that still fits the room. The plant only has to clear an obstacle
//              one way round — past its left, past its right, over it or under it — so each obstacle
//              contributes the roomiest of those four, and the room's walls contribute containment.
// The film then takes the design's own fraction of that room, FIG_S = 0.40. At 1920×1080 the numerator
// and the denominator are the same call on the same frame, so the quotient is exactly 1 and the scale is
// exactly 0.40: the 16:9 plate is byte-for-byte what it always was.
const FIG_S = 0.40;
function figScale(L, box) {
  const { CX, CY, BORDER, STRIP, SLOTS, SLOT_ORDER, RR, LAB_BOX, TITLE_BOT } = L, { hw, up, dn } = box, lim = [];
  const clear = (x0, y0, x1, y1) => {
    const ways = [(x0 - CX) / hw, (CX - x1) / hw, (y0 - CY) / dn, (CY - y1) / up].filter(v => v > 0);
    if (ways.length) lim.push(Math.max(...ways));
  };
  for (const p of LAB_BOX) clear(Math.min(p[0][0], p[3][0]), Math.min(p[0][1], p[1][1]), Math.max(p[1][0], p[2][0]), Math.max(p[2][1], p[3][1]));
  for (const k of SLOT_ORDER) clear(SLOTS[k][0] - RR, SLOTS[k][1] - RR, SLOTS[k][0] + RR, SLOTS[k][1] + RR);
  // and the room's own walls: inside the border, under the title block, clear of the chart strip
  lim.push((CX - BORDER[0]) / hw, (BORDER[2] - CX) / hw, (CY - BORDER[1]) / up, (BORDER[3] - CY) / dn, (CY - TITLE_BOT) / up, (STRIP[1] - CY) / dn);
  return Math.min(...lim.filter(v => v > 0));
}

// FILM_META.aspects —— 这部影片**声明支持**的输出比例清单（渲染侧据此核对并警告，见下面的 frameWarning）。
//   · 这里能列出 5 个，是因为 makeFilm 从 opts.W/opts.H 重排了整个版面（见 layout() 上面的说明）：
//     版框随帧拉伸（fx/fy），圆窗半径、字号、引线、海图刻度随 S = min(fx,fy) 缩放，位置按帧高比例走。
//     1920×1080 时 fx = fy = S = 1，逐字节退化成设计帧，所以 16:9 与改造前完全一致。
//   · **「支持」的准确含义**：版面会**重排**（不裁切）、刻名仍可读 —— 不是「每种比例下每块几何都等比」。
//   · **一处诚实的例外（有意取舍，不是 bug）**：海图长条内部的几何（岸线、航线、站点间距、刻度）是在条带
//     自己的矩形里画的，非 16:9 下随条带**各向异性拉伸**：9:16 时水平约 0.5625×、垂直约 1.7778×，
//     长条长宽比从 9.53 变成约 3.02（形变约 3.16×）。同时罗盘半径与线宽走 S = min(fx,fy)（不跟条带拉伸），
//     所以**海图在非 16:9 下自身并不自洽**（罗盘仍是正圆，海岸线却跟着拉伸）。修法有两条，代价都很大：
//     按 S 把海图缩到 1620:170 居中会丢掉满宽观感，9 个站点 / 长条框 / 图注 / 版权页全要挪；给内部几何加
//     等比子变换，则站点坐标、引线锚点、LINES / probeAt 契约全要重验。故保留当前拉伸（至少刻名可读），
//     并在此写明 —— 声明不再承诺做不到的事。
//   · 语义（全库约定）：aspects 列出「这部影片真的能正确构图」的比例；**不写 = 只支持 16:9**
//     （即「没改造过」，按 1920×1080 的绝对像素构图，给别的尺寸会被裁切）。
//   · 控制台靠**读这段源码文本**探测它（影片模块是浏览器 ESM，node 不能 import），
//     见 D:\lemo-tools\lib\aspects.mjs。所以这个字面量要保持「aspects 后跟一个方括号数组」的形状。
export const FILM_META = { id: 'coffee', title: 'Coffea arabica', style: 'Copperplate Engraving', aspects: ['16:9', '9:16', '3:4', '4:3', '1:1'] };

// 帧的构图闸门。makeFilm 从视口拿到 W/H（main.js 传的 opts.W/opts.H），而渲染侧（core/render）**不校验**
// FILM_META.aspects —— 于是 `--size 2000x100` 之类可以绕过声明，悄悄出一部构图废掉的片子。
// 这里**不拒绝**：still.mjs / video.mjs 是给人做实验的低层工具，全库 35 个 demo/build.sh（43 个风格里 8 个没带
// build.sh）都直接调它们，拒绝会让合法实验做不了。但**绝不静默**：打一条可读的 console.warn（页面警告由
// core/render/page.mjs 的 openDemo(..., { warnings: true }) 带回终端）。清单直接读 FILM_META.aspects，声明改了警告跟着改，只有一份真相。
// 口径：ls styles/*/demo/build.sh | wc -l = 35；grep -l -- --size styles/*/demo/build.sh 为空（没有一个传尺寸）。
const ASPECT_TOL = 0.02;   // 与 D:\lemo-tools\lib\aspects.mjs 的 ASPECT_TOL 同值，留给自定义尺寸的余量
function frameWarning(W, H) {
  const r = W / H, list = FILM_META.aspects;
  const fits = list.some(id => { const [a, b] = String(id).split(':').map(Number); return a > 0 && b > 0 && Math.abs(r - a / b) / (a / b) <= ASPECT_TOL; });
  if (fits) return null;
  const gcd = (x, y) => (y ? gcd(y, x % y) : x), k = gcd(W, H) || 1, ar = `${W / k}:${H / k}`;
  // 长度必须留在 300 字符内：core/render/page.mjs 把页面警告截到 300 字符再打印，超了会断在半句上。
  return `[film_coffee] frame ${W}×${H} (${ar}) is not a declared aspect (this film composes for ${list.join(', ')}). `
    + `It will be squashed or cropped: the plant smears, the engraved type falls below reading size, the sea chart `
    + `stretches off its band — the composition is not guaranteed.`;
}
// filled by makeFilm (same array object, so window.LINES sees the content)
export const LINES = [];
let PROBE = null;

// ---------------------------------------------------------------------------- optional subjects
// coffee.js / details_coffee.js / chart.js are written in parallel by other authors. They are loaded lazily so
// this page still boots (with a stand-in figure) while they are missing; a plain static import would 404 and the
// render harness treats a missing module script as fatal.
const exists = async p => { try { const r = await fetch(p); return r.ok; } catch { return false; } };
let buildCoffee = null, buildDetailCoffee = null, DETAILS_COFFEE = null, buildChart = null;
if (await exists('./subjects/coffee.js')) { try { buildCoffee = (await import('./subjects/coffee.js')).buildCoffee; } catch (e) { console.warn('coffee subject failed', e.message); } }
if (await exists('./subjects/details_coffee.js')) { try { const m = await import('./subjects/details_coffee.js'); buildDetailCoffee = m.buildDetail; DETAILS_COFFEE = m.DETAILS || {}; } catch (e) { console.warn('coffee details failed', e.message); } }
if (await exists('./subjects/chart.js')) { try { buildChart = (await import('./subjects/chart.js')).buildChart; } catch (e) { console.warn('chart failed', e.message); } }

// ---------------------------------------------------------------------------- stand-ins
const mkRegions = list => { const p = new Path2D(); for (const sh of list) p.addPath(sh.path); const polys = list.flatMap(sh => sh.polys); return { path: p, polys, bbox: B.bboxOf(polys) }; };

// A plain plant, only so the page renders before subjects/coffee.js lands. Same contract: ol0 is one long stroke.
// It is drawn through the same centre and the same fitted scale as the real figure, so the labels stay clear either way.
function standInCoffee({ CX, CY, SS }) {
  const P = (x, y) => [CX + (x - 960) * SS, CY + (y - 540) * SS], RS = r => r * SS;
  const ink = new B.Ink();
  const stem = [];
  for (let i = 0; i <= 22; i++) { const u = i / 22; stem.push(P(960 + Math.sin(u * 2.4) * 15 - 7 * (1 - u) + 5 * u, 772 - u * 524)); }
  for (let i = 22; i >= 0; i--) { const u = i / 22; stem.push(P(960 + Math.sin(u * 2.4) * 15 + 7 * (1 - u) - 5 * u, 772 - u * 524)); }
  const stemSh = B.ring(stem);
  const leafSh = [[-1, 648, 0.55], [1, 556, 0.5], [-1, 452, 0.45], [1, 366, 0.42]]
    .map(([sx, y, rot], k) => { const c = P(960 + sx * (176 + k * 4), y); return B.ring(B.ellipsePts(c[0], c[1], RS(172 - k * 8), RS(74), sx * rot)); });
  const cherrySh = [[-96, 706], [96, 700], [0, 752]].map(([dx, y]) => { const c = P(960 + dx, y); return B.ellipse(c[0], c[1], RS(32), RS(36)); });
  const fc = P(960, 246);
  const flowerSh = [B.ellipse(fc[0], fc[1], RS(48), RS(48)), B.ellipse(fc[0], fc[1], RS(18), RS(18))];
  const beanSh = [B.ellipse(fc[0], fc[1], RS(11), RS(15))];
  const sc = P(960, 560);
  const toneL = B.sphereTone(sc[0], sc[1], RS(420), RS(460), { base: 0.06 });
  ink.group('ol0'); B.outline(ink, stemSh.polys[0], { w: 2.4, vary: 0.9, seed: 11, run: 170 });
  ink.group('ol');
  for (const sh of leafSh) B.outline(ink, sh.polys[0], { w: 1.8, vary: 0.9, seed: 12 });
  for (const sh of cherrySh) B.outline(ink, sh.polys[0], { w: 1.5, vary: 0.8, seed: 13 });
  B.outline(ink, flowerSh[0].polys[0], { w: 1.3, vary: 0.7, seed: 14 });
  ink.group('h1');
  for (const sh of leafSh) B.hatch(ink, sh.polys, { angle: 0.45, spacing: 5, tone: toneL, thr: 0.14, wMax: 1.6, seed: 21 });
  for (const sh of cherrySh) B.hatch(ink, sh.polys, { angle: 0.15, spacing: 3.4, tone: B.sphereTone(...P(960, 716), RS(130), RS(60), { base: 0.2 }), thr: 0.14, wMax: 1.5, seed: 22 });
  B.hatch(ink, flowerSh[0].polys, { angle: 1.1, spacing: 3.6, tone: () => 0.42, thr: 0.14, wMax: 1.4, seed: 23 });
  ink.group('h2');
  for (const sh of leafSh) B.hatch(ink, sh.polys, { angle: 1.95, spacing: 5.6, tone: toneL, thr: 0.5, wMax: 1.1, seed: 31 });
  for (const sh of cherrySh) B.hatch(ink, sh.polys, { angle: 1.7, spacing: 3.8, tone: B.sphereTone(...P(960, 716), RS(130), RS(60), { base: 0.3 }), thr: 0.5, wMax: 1.0, seed: 32 });
  ink.group('h3');
  for (const sh of leafSh) B.hatch(ink, sh.polys, { angle: 1.4, spacing: 6.4, tone: toneL, thr: 0.74, wMax: 0.9, seed: 41 });
  B.stipple(ink, flowerSh[0].polys, { density: 0.004, tone: () => 0.5, r: 0.6, seed: 51, thr: 0.1 });
  const c1 = P(1056, 700), c2 = P(1136, 556);
  return {
    ink,
    regions: { leaf: mkRegions(leafSh), cherry: mkRegions(cherrySh), stem: mkRegions([stemSh]), flower: mkRegions(flowerSh), bean: mkRegions(beanSh) },
    focus: { flower: { x: fc[0], y: fc[1], r: RS(54) }, cherry: { x: c1[0], y: c1[1], r: RS(42) }, seed: { x: fc[0], y: fc[1], r: RS(26) }, leaf: { x: c2[0], y: c2[1], r: RS(118) }, eye: { x: fc[0], y: fc[1], r: RS(60) } },
  };
}

// The nine ports of the route, laid along the chart strip. Stand-in for chart.stations. The numbers are the
// design frame's own (the 150…1770 × 782…952 band), mapped onto whatever strip this frame has.
const ST_KEYS = ['kaffa', 'mocha', 'constantinople', 'venice', 'london', 'java', 'martinique', 'brazil', 'kenya'];
const ST_DESIGN = {
  kaffa: { x: 300, y: 900, label: 'KAFFA' },
  mocha: { x: 486, y: 876, label: 'MOCHA' },
  constantinople: { x: 712, y: 838, label: 'CONSTANTINOPLE' },
  venice: { x: 866, y: 818, label: 'VENICE' },
  london: { x: 990, y: 806, label: 'LONDON' },
  java: { x: 1288, y: 870, label: 'JAVA' },
  martinique: { x: 1562, y: 898, label: 'MARTINIQUE' },
  brazil: { x: 1426, y: 926, label: 'BRAZIL' },
  kenya: { x: 636, y: 928, label: 'KENYA' },
};
const stripX = (STRIP, u) => STRIP[0] + (u - 150) * ((STRIP[2] - STRIP[0]) / 1620);
const stripY = (STRIP, v) => STRIP[1] + (v - 782) * ((STRIP[3] - STRIP[1]) / 170);
const standInStations = ({ STRIP }) => Object.fromEntries(ST_KEYS.map(k => [k, { x: stripX(STRIP, ST_DESIGN[k].x), y: stripY(STRIP, ST_DESIGN[k].y), label: ST_DESIGN[k].label }]));
function standInChart({ STRIP, S }) {
  const ink = new B.Ink(), R = B.RNG(21);
  const X = u => stripX(STRIP, u), Y = v => stripY(STRIP, v), Wd = r => r * S;
  const ST = standInStations({ STRIP });
  const pts = ST_KEYS.map(k => [ST[k].x, ST[k].y]);
  // coast: two long shore lines crossing the band
  const coast = (v0, amp, seed) => { const P = []; for (let x = STRIP[0]; x <= STRIP[2]; x += 22 * S) P.push([x, Y(v0) + Math.sin(x / (190 * S) + seed) * amp * S + (B.noise1(x / (70 * S), seed) - 0.5) * 18 * S]); return P; };
  ink.group('col');
  B.stroke(ink, coast(800, 16, 1), 1.7 * S, { taper: 90 * S, seed: 61 });
  B.stroke(ink, coast(936, 12, 4), 1.5 * S, { taper: 90 * S, seed: 62 });
  // land hatching above and below the shores
  const landA = B.ring([[STRIP[0], STRIP[1]], [STRIP[2], STRIP[1]], [STRIP[2], Y(800)], [STRIP[0], Y(800)]]);
  const landB = B.ring([[STRIP[0], Y(936)], [STRIP[2], Y(936)], [STRIP[2], STRIP[3]], [STRIP[0], STRIP[3]]]);
  ink.group('ch1');
  B.hatch(ink, landA.polys, { angle: -0.35, spacing: 7 * S, tone: () => 0.34, thr: 0.14, wMax: 1.1 * S, seed: 63 });
  B.hatch(ink, landB.polys, { angle: -0.35, spacing: 7 * S, tone: () => 0.34, thr: 0.14, wMax: 1.1 * S, seed: 64 });
  ink.group('ch2');
  B.hatch(ink, landA.polys, { angle: 0.9, spacing: 8 * S, tone: () => 0.62, thr: 0.5, wMax: 0.9 * S, seed: 65 });
  B.hatch(ink, landB.polys, { angle: 0.9, spacing: 8 * S, tone: () => 0.62, thr: 0.5, wMax: 0.9 * S, seed: 66 });
  // compass rose
  const rx = X(1650), ry = Y(850), rr = 58 * S;
  ink.group('rose');
  B.outline(ink, B.ellipsePts(rx, ry, rr, rr, 0, 64), { w: 1.4 * S, vary: 0.3, seed: 71 });
  B.outline(ink, B.ellipsePts(rx, ry, rr * 0.72, rr * 0.72, 0, 48), { w: 0.7 * S, vary: 0.2, seed: 72 });
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, l = k % 2 ? rr * 0.7 : rr * 0.98; B.stroke(ink, [[rx, ry], [rx + Math.cos(a) * l, ry + Math.sin(a) * l]], 0.9 * S, { taper: 6 * S, seed: 73 + k }); }
  // the route: a dotted trail through the ports
  ink.group('route');
  for (let k = 0; k + 1 < pts.length; k++) { const [ax, ay] = pts[k], [bx, by] = pts[k + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(L / (26 * S)));
    for (let j = 0; j < n; j++) { const u0 = j / n, u1 = Math.min(1, u0 + 0.5 / n); B.stroke(ink, [[lerp(ax, bx, u0), lerp(ay, by, u0)], [lerp(ax, bx, u1), lerp(ay, by, u1)]], 1.0 * S, { taper: 3 * S, seed: 81 + k }); } }
  ink.group('stat');
  for (const k of ST_KEYS) { const s = ST[k]; B.outline(ink, B.ellipsePts(s.x, s.y, 9 * S, 9 * S, 0, 20), { w: 1.1 * S, vary: 0.2, seed: 91 }); ink.dot(s.x, s.y, 1.6 * S); }
  ink.group('scale');
  for (let k = 0; k <= 8; k++) { const x = X(160 + k * 34); B.stroke(ink, [[x, Y(962)], [x, Y(962) - (k % 2 ? 7 : 12) * S]], 0.8 * S, { taper: 2 * S, seed: 95 }); }
  B.stroke(ink, [[X(160), Y(962)], [X(432), Y(962)]], 0.9 * S, { taper: 4 * S, seed: 96 });
  return {
    ink, stations: ST, route: pts.map(([x, y]) => ({ x, y })), rose: { x: rx, y: ry, r: rr },
    regions: { sea: mkRegions([B.ring([[STRIP[0], STRIP[1]], [STRIP[2], STRIP[1]], [STRIP[2], STRIP[3]], [STRIP[0], STRIP[3]]])]), land: mkRegions([landA, landB]) },
  };
}

// ---------------------------------------------------------------------------- subtitles + probe
// Every line of the content's voice, with the anchors the picture must honour while it is spoken.
// The `text` anchors are the strings actually cut on the plate — the title and the engraved name of each port —
// and both are read from the content (title / details[].latin / stName), so swapping the content file for another
// language moves the anchors with it and this table needs no edit. `station` anchors stay the lower-case English
// keys: they are the language-independent ports of the chart. See `stName` in makeFilm.
const lineSpec = (C, stName) => {
  const lat = i => String(((C.details || [])[i] || {}).latin || '');
  return [
    ['title', [{ kind: 'text', value: String(C.title || '').toUpperCase() }, { kind: 'element', value: 'plant' }]],
    ['d1', [{ kind: 'roundel', value: 0 }, { kind: 'element', value: 'flower' }, { kind: 'label', value: lat(0) }]],
    ['d2', [{ kind: 'roundel', value: 1 }, { kind: 'element', value: 'cherry' }, { kind: 'label', value: lat(1) }]],
    ['d3', [{ kind: 'roundel', value: 2 }, { kind: 'element', value: 'seeds' }, { kind: 'label', value: lat(2) }]],
    ['d4', [{ kind: 'roundel', value: 3 }, { kind: 'element', value: 'harbour' }, { kind: 'station', value: 'mocha' }, { kind: 'text', value: stName('mocha') }]],
    ['s1', [{ kind: 'station', value: 'constantinople' }, { kind: 'text', value: stName('constantinople') }]],
    ['s2', [{ kind: 'station', value: 'venice' }, { kind: 'text', value: stName('venice') }, { kind: 'station', value: 'london' }, { kind: 'text', value: stName('london') }]],
    ['s3', [{ kind: 'station', value: 'java' }, { kind: 'station', value: 'martinique' }, { kind: 'station', value: 'brazil' }]],
    ['s4', [{ kind: 'station', value: 'kenya' }, { kind: 'text', value: stName('kenya') }]],
  ];
};
// which port is named just before which line (the engraver cuts the name, then the voice names it)
const ST_LINES = [['d4', ['mocha']], ['s1', ['constantinople']], ['s2', ['venice', 'london']], ['s3', ['java', 'martinique', 'brazil']], ['s4', ['kenya']]];
// a detail's part name in the picture
const FOCUS_EL = { flower: 'flower', cherry: 'cherry', seed: 'seeds', harbour: 'harbour' };

/** Pure: what is on the plate at t. Given the same film, the same t always gives the same answer. */
export function probeAt(t) {
  const s = PROBE;
  if (!s) return { texts: [], stations: [], roundels: [], regions: [], elements: [], labels: [] };
  const upto = list => { const out = []; for (const e of list) if (e.t <= t) out.push(e.v); return out; };
  const uniq = a => [...new Set(a)];
  return { texts: uniq(upto(s.texts)), stations: uniq(upto(s.stations)), roundels: uniq(upto(s.roundels)), regions: uniq(upto(s.regions)), elements: uniq(upto(s.elements)), labels: uniq(upto(s.labels)) };
}

export function makeFilm(C, voiceDur = {}, opts = {}) {
  // The frame we are drawing into. main.js hands us the viewport; without opts we keep the design frame, so a
  // caller that never asked for a size gets exactly the picture this film has always produced.
  const W = opts.W ?? NATIVE.W, H = opts.H ?? NATIVE.H;
  const badFrame = frameWarning(W, H); if (badFrame) console.warn(badFrame);
  const G = layout(W, H), { fx, fy, S, PLATE, BORDER, SLOTS, SLOT_ORDER, RR, STRIP, NOTE, LEADN, labAnchor, LAB_BOX, CX, CY } = G;
  // The language version. Everything language-dependent comes from here: the faces, the letter spacing, the
  // roundel-number prefix, and the engraved port names (below). Swap the content file, not the code.
  const L = langOf(C);
  if (plate.setFonts) plate.setFonts(L.fonts); else Object.assign(FONTS, L.fonts);
  const details = (C.details || []).slice(0, 4);
  let coffee = null, chart = null;
  // The plant's own box, measured off the ink it will really cut — so a change to subjects/coffee.js moves the fit
  // with it and this file never carries a second copy of the plant's dimensions. Then the scale that fits that box
  // to this frame's room. Should the subject fail to build, fall back to the old scalar rule.
  let box = null;
  try {
    const probe = buildCoffee ? buildCoffee({ x: 0, y: 0, s: 1, seed: 12 }) : standInCoffee({ CX: 0, CY: 0, SS: 1 });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of probe.ink.S) { const b = st.bb; if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1]; if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3]; }
    box = { hw: Math.max(x1, -x0), up: -y0, dn: y1 };
  } catch (e) { console.warn('coffee probe failed', e.message); }
  const SS = box ? FIG_S * (figScale(G, box) / figScale(layout(NATIVE.W, NATIVE.H), box)) : FIG_S * S;
  if (buildCoffee) { try { coffee = buildCoffee({ x: CX, y: CY, s: SS, seed: 12 }); } catch (e) { console.warn('coffee build failed', e.message); } }
  if (!coffee) coffee = standInCoffee({ CX, CY, SS });
  if (buildChart) { try { chart = buildChart({ x0: STRIP[0], y0: STRIP[1], x1: STRIP[2], y1: STRIP[3], seed: 21 }); } catch (e) { console.warn('chart build failed', e.message); } }
  if (!chart) chart = standInChart(G);
  const stationsAll = chart.stations || standInStations(G);
  // The name cut beside a port. content.stations maps the language-independent key to this language's name;
  // without it (every Latin content file) the style's own engraved capital stands. Same source for the plate,
  // the probe record and the LINES anchors, so the three can never disagree.
  const stName = k => {
    const v = C.stations && C.stations[k];
    return v ? String(v) : String((stationsAll[k] && stationsAll[k].label) || k).toUpperCase();
  };

  // ------------------------------------------------------------------ timeline (seconds)
  const T = {};
  T.hook = [0, 2.5]; T.lift = 2.0; T.peel = [2.5, 3.2];
  T.build = { ol: [2.6, 4.6], h1: [3.3, 5.5], h2: [4.4, 6.2], h3: [5.0, 6.9], border: [3.0, 5.6] };
  T.title = 6.25;
  T.d0 = 9.375;
  const dets = []; let s = T.d0;
  // 'A' the long signature detail, 'B' a tilt-down detail, 'C' pull-back-then-push; the score uses the same roles
  const roleOf = i => i === 0 ? 'A' : (i === 1 && details.length > 2) ? 'B' : 'C';
  details.forEach((d, i) => { const D = i === 0 ? 9 * BEAT : 7 * BEAT; dets.push({ ...d, i, s, D, long: i === 0, role: roleOf(i) }); s += D; });
  T.dEnd = s; T.gather = [s, s + 2 * BEAT]; T.silence = [s + 2 * BEAT, s + 4 * BEAT];
  T.colour = [s + 4 * BEAT, s + 12 * BEAT]; T.landing = [s + 12 * BEAT, s + 19 * BEAT]; T.end = [s + 19 * BEAT, s + 26 * BEAT];
  let DUR = T.end[1];   // 结构片长；配音排完之后可能不够长，见下方「收尾补长」

  // ------------------------------------------------------------------ ink schedules
  const ink = coffee.ink;
  ink.schedule('ol0', -2.6, 4.2, { conc: 1 });
  ink.schedule('ol', ...T.build.ol, { conc: 16 });
  ink.schedule('h1', ...T.build.h1, { conc: 70 });
  ink.schedule('h2', ...T.build.h2, { conc: 70 });
  ink.schedule('h3', ...T.build.h3, { conc: 90 });
  ink.build();
  // the chart is cut, not faded in: base and rose with the border, route and station rings while the camera pans it
  const ci = chart.ink, B0 = T.build.border[0], B1 = T.build.border[1];
  ci.schedule('col', B0, B1, { conc: 6 });
  ci.schedule('rose', B0, B1, { conc: 8 });
  ci.schedule('ch1', B0 + 0.6, B1 + 0.6, { conc: 30 });
  ci.schedule('ch2', B0 + 1.4, B1 + 1.0, { conc: 30 });
  ci.schedule('scale', B1 - 0.4, B1 + 1.8, { conc: 4 });
  ci.schedule('route', T.gather[0], T.gather[0] + 1.05, { conc: 2 });
  ci.schedule('stat', T.gather[0] + 0.15, T.gather[1] - 0.05, { conc: 4 });
  ci.build();
  // the traced design: faint scratches on the copper that the burin will follow
  const guide = new B.Ink(); guide.S = ink.S.filter(x => x.g === 'ol' || x.g === 'ol0').map(x => ({ ...x, s0: -20, s1: -19 })); guide.build();
  const frameInk = new B.Ink(); borderInk(frameInk, BORDER); frameInk.schedule('main', ...T.build.border, { conc: 1.2 }); frameInk.build();

  // ------------------------------------------------------------------ details: slots, focus side, roundel content, timing
  const OBST = Object.keys(coffee.regions);
  const plateArea = (PLATE[2] - PLATE[0]) * (PLATE[3] - PLATE[1]);
  const obstacles = () => [
    ...OBST.flatMap(k => {
      const r = coffee.regions[k]; if (!r) return [];
      const [x0, y0, x1, y1] = r.bbox;
      if ((x1 - x0) * (y1 - y0) > 0.55 * plateArea) return [];        // a region covering most of the plate would make every leader unroutable
      return r.polys;
    }),
    ...LAB_BOX.map(p => [[p[0][0] - 18 * S, p[0][1] - 18 * S], [p[1][0] + 18 * S, p[0][1] - 18 * S], [p[1][0] + 18 * S, p[2][1] + 18 * S], [p[0][0] - 18 * S, p[2][1] + 18 * S]]),   // the margin labels, grown by AIR
  ];
  for (const d of dets) {
    d.slotName = SLOT_ORDER[d.i]; d.slot = SLOTS[d.slotName];
    // the 4th detail is the harbour inset: its point is a station on the chart, not a part of the plant
    const harbour = d.focus === 'harbour' && stationsAll.mocha;
    if (harbour) d.f = { x: stationsAll.mocha.x, y: stationsAll.mocha.y, r: 52 * S };
    else { const f = coffee.focus[d.focus] || coffee.focus.eye; const left = d.slot[0] < W / 2, mx = x => left === (x < W / 2) ? x : W - x; d.f = { x: mx(f.x), y: f.y, r: f.r }; }
    d.art = (DETAILS_COFFEE && DETAILS_COFFEE[d.focus] && buildDetailCoffee) ? buildDetailCoffee(d.focus) : { magnify: true, regions: {} };
    // relative timing: the first detail is the long signature move; the second rides a tilt; later ones play wide
    const a = d.i === 0 ? { push: [0, 1.1], ring: [1.05, 1.45], burn: [1.1, 1.4], cont: [1.35, 3.5], travel: [1.9, 3.4], name: 3.3, latin: 3.6, note: 3.9 }
            : d.role === 'B' ? { push: [0, 1.0], ring: [0.5, 0.8], burn: [0.52, 0.75], cont: [0.7, 2.2], travel: [0.8, 1.8], name: 1.9, latin: 2.15, note: 2.4 }
                        : { push: [0, 1.0], ring: [0.5, 0.8], burn: [0.52, 0.75], cont: [0.7, 2.2], travel: [0.9, 2.1], name: 2.0, latin: 2.25, note: 2.5 };
    for (const k in a) a[k] = Array.isArray(a[k]) ? a[k].map(v => v + d.s) : a[k] + d.s;
    d.a = a;
    const [c0, c1] = a.cont, DD = c1 - c0;
    if (!d.art.magnify) {
      d.art.ink.schedule('ol', c0, c0 + 0.5 * DD, { conc: 12 });
      d.art.ink.schedule('h1', c0 + 0.2 * DD, c0 + 0.78 * DD, { conc: 60 });
      d.art.ink.schedule('h2', c0 + 0.42 * DD, c0 + 0.92 * DD, { conc: 60 });
      d.art.ink.schedule('h3', c0 + 0.5 * DD, c1, { conc: 60 });
      d.art.ink.schedule('rule', c0 + 0.55 * DD, c1, { conc: 30 });
      d.art.ink.build();
    }
    d.lab = { name: `${L.labelPrefix} ${d.i + 1}  ·  ${String(d.name || '').toUpperCase()}`, latin: d.latin || '', note: d.note || '' };
    // The margin lettering is cut as soon as the ring is scribed, so that for the whole spoken line the plate
    // already carries the name it is talking about (see LINES / probeAt).
    const r1 = a.ring[1];
    d.labT = { name: [r1, r1 + 0.30], latin: [r1 + 0.05, r1 + 0.35], note: [r1 + 0.30, r1 + 1.40] };
    // the label column sits inboard of the roundel, on the side facing the plate centre (the strip below is taken)
    const onLeft = d.slot[0] < W / 2;
    d.labC = { cx: onLeft ? d.slot[0] + RR + 26 * S + NOTE.width / 2 : d.slot[0] - RR - 26 * S - NOTE.width / 2, w: NOTE.width };
    // the leader. It must never cross a margin label; crossing the figure itself is what a leader is for (it points
    // into the plate). So the labels decide the route, and the figure is only a preference.
    const obs = obstacles().filter(p => !B.inPoly([p], d.f.x, d.f.y));
    const rim = (px, py) => { const dx = px - d.slot[0], dy = py - d.slot[1], L = Math.hypot(dx, dy) || 1; return [d.slot[0] + dx / L * RR, d.slot[1] + dy / L * RR]; };
    const march = (polys, a0, b0) => { const L = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]); for (let q = 14 * S; q < L; q += 6 * S) { const x = a0[0] + (b0[0] - a0[0]) * q / L, y = a0[1] + (b0[1] - a0[1]) * q / L; for (let k = 0; k < 9; k++) { const rr = k ? 34 * S : 0, an = k * Math.PI / 4; if (B.inAny(polys, x + Math.cos(an) * rr, y + Math.sin(an) * rr)) return false; } } return true; };
    const lab = LAB_BOX.map(p => [[p[0][0] - 18 * S, p[0][1] - 18 * S], [p[1][0] + 18 * S, p[0][1] - 18 * S], [p[1][0] + 18 * S, p[2][1] + 18 * S], [p[0][0] - 18 * S, p[2][1] + 18 * S]]);
    const clear = (a0, b0) => march(lab, a0, b0), open = (a0, b0) => march(obs, a0, b0);
    const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    let best = null; const r0 = rim(d.f.x, d.f.y);
    if (clear([d.f.x, d.f.y], r0)) best = { wp: null, L: len([d.f.x, d.f.y], r0) };
    else {
      // one elbow is enough, and the corners of the label rectangles are the only ones worth trying: a grid search
      // over the whole plate costs far more than it is worth once the labels are obstacles too.
      const EP = 70 * S, cands = [];
      for (const b of LAB_BOX) {
        const x0 = Math.min(...b.map(p => p[0])) - EP, x1 = Math.max(...b.map(p => p[0])) + EP;
        const y0 = Math.min(...b.map(p => p[1])) - EP, y1 = Math.max(...b.map(p => p[1])) + EP;
        cands.push([x0, y0], [x1, y0], [x1, y1], [x0, y1], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]);
      }
      let soft = null;
      for (const wp of cands) {
        if (Math.hypot(wp[0] - d.slot[0], wp[1] - d.slot[1]) < RR + 20 * S) continue;
        const r1b = rim(wp[0], wp[1]);
        if (!clear([d.f.x, d.f.y], wp) || !clear(wp, r1b)) continue;
        const L = len([d.f.x, d.f.y], wp) + len(wp, r1b);
        if (!soft || L < soft.L) soft = { wp, L };
        if ((!best || L < best.L) && open([d.f.x, d.f.y], wp) && open(wp, r1b)) best = { wp, L };
      }
      if (!best) best = soft;
    }
    d.wp = best ? best.wp : null;
  }

  // ------------------------------------------------------------------ hand colouring
  const colours = Object.fromEntries((C.colors || []).map(c => [c.region, c.color]));
  const wash = new Wash({ scale: 1.5 }), dWash = dets.map(() => new Wash({ scale: 0.55 }));
  const regionOf = name => coffee.regions[name] || chart.regions[name];
  const cOrder = (C.colors || []).map(c => c.region);
  const c0 = T.colour[0] + 0.1;
  const dropT = {};
  cOrder.forEach((name, k) => {
    const r = regionOf(name); if (!r) return;
    const t0 = c0 + k * 0.42; dropT[name] = t0;
    const origin = name === 'sea' ? [STRIP[0] + 220 * S, STRIP[1] + 84 * S] : null;
    wash.add({ path: r.path, polys: r.polys, color: colours[name], alpha: name === 'sea' ? 0.5 : name === 'cherry' ? 0.78 : 0.7, origin, t0, dur: name === 'sea' ? 1.6 : 1.25, seed: k + 1, spill: 3.5 * S, lift: 0.55 });
    dets.forEach((d, j) => { for (const [rn, rr] of Object.entries(d.art.regions)) { if (rn !== name && rn !== d.focus) continue; dWash[j].add({ path: rr.path, polys: rr.polys, color: colours[name], alpha: 0.6, t0: t0 + 0.15, dur: 1.3, seed: k + 11 + j, spill: 12, offset: [7, 5] }); } });
  });

  // ------------------------------------------------------------------ voice plan (lines from content; durations from the TTS)
  const lines = (C.voice && C.voice.lines) || [];
  // Fallback reading rate when there is no voice duration table for this take: characters per second, from the
  // language record (14 for Latin, 4.5 for Chinese — a syllable per character reads far slower). en is unchanged.
  const vd = id => voiceDur[id] || Math.max(1.6, (lines.find(l => l.id === id)?.text.length || 30) / L.cps);
  const vo = [];
  const put = (id, t) => { const l = lines.find(x => x.id === id); if (l) vo.push({ id, t0: t, t1: t + vd(id), text: l.text }); };
  // the moment each line is spoken (the plate has already been prepared for it by then)
  const SPOKEN = { title: 6.4, d1: 10.5, d2: 15.7, d3: 20.0, d4: 24.0, s1: 30.8, s2: 34.5, s3: 37.4, s4: 40.8 };
  // SPOKEN 只是「这一句最早能开口」的时刻，不是硬性的：合成音的真实长度会随音色、语速、语言浮动，
  // 而 plate 在开口之前早就铺好了，所以晚说一点点画面完全接得住。
  // 这里按顺序把起点推到「上一条说完 + 0.12s」之后，保证任意两条配音不重叠 ——
  // 排得开时起点与 SPOKEN 一模一样（视觉节奏不动），只有排不开时才顺延。
  // （实测踩到过：s4 在 40.8 开口，而 s3 的语音到 41.08 才说完，两条叠了 0.28s，
  //   连带把 s3/s4 的字幕窗挤到比语音还短，字幕先消失、语音还在响。）
  let voCursor = -1e9;
  for (const [id, t] of Object.entries(SPOKEN)) {
    const start = Math.max(t, voCursor + 0.12);
    put(id, start);
    voCursor = start + vd(id);
  }
  const subs = vo.map((v, i) => ({ t0: v.t0 - 0.1, t1: Math.min(v.t1 + 0.6, vo[i + 1] ? vo[i + 1].t0 - 0.2 : 1e9), text: v.text }));
  // 收尾补长：上面的顺延可能把最后一句顶出结构片长（实测 s4 说完要 44.97 s，而结构片长只有 44.375 s，
  // 混流按片长切，最后 0.6 s 的话就被切掉了）。这里把片长补到「最后一句说完 + 0.4 s」——
  // 画面在收尾镜头上多停一会儿，比把话切掉好。排得下时完全不动。
  const voTail = vo.reduce((m, v) => Math.max(m, v.t1), 0);
  if (voTail + 0.4 > DUR) DUR = voTail + 0.4;

  // ------------------------------------------------------------------ the ports, named just before their line
  const STATIONS = [];
  for (const [id, keys] of ST_LINES) {
    const v = vo.find(x => x.id === id); if (!v) continue;
    const n = keys.length;
    keys.forEach((k, j) => {
      const st = stationsAll[k]; if (!st) return;
      const end = v.t0 - 0.3 - 0.18 * (n - 1 - j);              // the last name is done 0.3 s before the line
      const dur = n === 1 ? 0.30 : 0.22;                        // n = 1 gives exactly the 0.6 s / 0.3 s the contract asks
      STATIONS.push({ key: k, label: stName(k), x: st.x, y: st.y, n0: end - dur, n1: end });
    });
  }

  // The origin port is named while the route is being cut: no line speaks it, but a chart of the voyage is
  // incomplete without the port the seed left from.
  if (stationsAll.kaffa) STATIONS.push({ key: 'kaffa', label: stName('kaffa'), x: stationsAll.kaffa.x, y: stationsAll.kaffa.y, n0: T.gather[0] + 0.45, n1: T.gather[0] + 0.85 });

  // ------------------------------------------------------------------ camera
  const first = ink.S.find(x => x.g === 'ol0') || ink.S[0];
  const tipAt = t => {
    if (!first) return { x: W / 2, y: 520 * fy, dx: 0, dy: -1 };
    const f = (first.n - 1) * clamp((t - first.s0) / (first.s1 - first.s0)), j = Math.min(first.n - 2, Math.floor(f)), u = f - j, xy = first.xy;
    const x = xy[2 * j] + (xy[2 * j + 2] - xy[2 * j]) * u, y = xy[2 * j + 1] + (xy[2 * j + 3] - xy[2 * j + 1]) * u;
    const k0 = Math.max(0, j - 3), k1 = Math.min(first.n - 1, j + 4), dx = xy[2 * k1] - xy[2 * k0], dy = xy[2 * k1 + 1] - xy[2 * k0 + 1], L = Math.hypot(dx, dy) || 1;
    return { x, y, dx: dx / L, dy: dy / L };
  };
  const HOOKZ = 4.2;
  const followCam = t => { const tp = tipAt(Math.min(t, T.lift)); return { cx: tp.x + 20 * S, cy: tp.y + 30 * S, z: HOOKZ * (1 - 0.03 * Math.min(t, 3)), rot: -0.05 + 0.012 * Math.min(t, 3) }; };
  const WIDE = { cx: W / 2, cy: H / 2, z: 1, rot: 0 };
  const keys = [];
  const K = (t, c, e = eio) => keys.push([t, c, e]);
  K(T.lift, followCam(T.lift));                 // the burin is followed for the first two seconds
  K(T.title, WIDE);                             // then a log pull-out lands on the whole plate
  K(T.build.h3[1], WIDE);
  K(T.d0, WIDE);
  const frameFor = d => {
    // the roundel and the label column it carries are the subject, but the frame must not walk off the sheet:
    // at z = 1.45 the view is 1324 wide, so the camera stays between the plate's margins.
    const onLeft = d.slot[0] < W / 2;
    return { cx: clamp(d.slot[0] + (onLeft ? 485 * S : -485 * S), 700 * fx, 1220 * fx), cy: clamp(d.slot[1], 300 * fy, 620 * fy), z: 1.45, rot: 0 };
  };
  for (const d of dets) {
    const a = d.a, fr = frameFor(d);
    if (d.i === 0) { d.st = { x: d.f.x + 14 * S, y: d.f.y + 2 * S }; K(a.push[1], { cx: d.f.x + 18 * S, cy: d.f.y + 4 * S, z: 4.3, rot: 0.012 }); K(a.travel[0], { cx: d.st.x, cy: d.st.y, z: 4.5, rot: 0.01 }, x => x); K(a.travel[1] + 0.6, fr); K(d.s + d.D, fr, x => x); }
    else if (d.role === 'B') { K(a.push[1], fr); K(d.s + d.D, fr, x => x); }   // same z, the frame only tilts down
    else { K(a.push[1], WIDE); K(d.s + 2.9, WIDE, x => x); K(d.s + 3.9, fr); K(d.s + d.D, fr, x => x); }
  }
  // the gather is a pan along the sheet at reading zoom: the route is cut on the chart while we watch it
  K(T.gather[0] + 0.18, { cx: 1240 * fx, cy: 560 * fy, z: 1.5, rot: 0 });
  K(T.gather[0] + 0.55, { cx: 1000 * fx, cy: 856 * fy, z: 1.58, rot: 0 });
  K(T.gather[1] - 0.08, { cx: 660 * fx, cy: 872 * fy, z: 1.58, rot: 0 });
  K(T.gather[1], WIDE);
  K(T.colour[0], WIDE);
  K(T.colour[0] + 2.5, { cx: 958 * fx, cy: 552 * fy, z: 1.018, rot: -0.0012 });        // a breath of a push while the wash blooms
  K(T.colour[1], WIDE);
  K(T.end[1] + 1, WIDE);
  const camAt = t => {
    if (t <= T.lift) return followCam(t);
    // the signature move: the camera rides with the roundel as it lifts off the flower and carries it to its slot
    const d0 = dets[0];
    if (d0 && t >= d0.a.travel[0] && t <= d0.a.travel[1] + 0.6) {
      const a = d0.a, u = seg(t, a.travel[0], a.travel[1] + 0.6), r = roundelAt(d0, Math.min(t, a.travel[1])), fr = frameFor(d0);
      const z = Math.exp(lerp(Math.log(4.5), Math.log(fr.z), eio(u))), w = Math.pow(ss(u), 1.6), k0 = ss(seg(t, a.travel[0], a.travel[0] + 0.5));
      const fpx = lerp(d0.st.x, r.x + (fr.cx - d0.slot[0]) * 0.35, k0), fpy = lerp(d0.st.y, r.y + (fr.cy - d0.slot[1]) * 0.35, k0);
      return { cx: lerp(fpx, fr.cx, w), cy: lerp(fpy, fr.cy, w), z, rot: lerp(0.01, 0, u) };
    }
    let i = 0; while (i < keys.length - 1 && keys[i + 1][0] <= t) i++;
    const [ta, ca] = keys[i], nx = keys[i + 1]; if (!nx) return ca;
    const [tb, cb, e] = nx; const u = e(seg(t, ta, tb));
    const za = Math.log(ca.z), zb = Math.log(cb.z), z = Math.exp(lerp(za, zb, u));
    const wa = 1 / ca.z, wb = 1 / cb.z, v = Math.abs(wb - wa) > 1e-6 ? (1 / z - wa) / (wb - wa) : u;
    const k = Math.abs(za - zb) > 0.3 ? clamp(v) : u;
    return { cx: lerp(ca.cx, cb.cx, k), cy: lerp(ca.cy, cb.cy, k), z, rot: lerp(ca.rot || 0, cb.rot || 0, u) };
  };

  // ------------------------------------------------------------------ roundel state
  function roundelAt(d, t) {
    const a = d.a; if (t < a.ring[0]) return null;
    const u = eio(seg(t, ...a.travel));
    const x = lerp(d.f.x, d.slot[0], u), y = lerp(d.f.y, d.slot[1], u) - Math.sin(u * Math.PI) * 30 * S, r = Math.exp(lerp(Math.log(d.f.r), Math.log(RR), u));
    return { x, y, r, ring: seg(t, ...a.ring), burn: seg(t, ...a.burn), travel: u };
  }

  // ------------------------------------------------------------------ what is on the plate at t (the consistency record)
  const titleDone = T.title + 0.65;
  const P = { texts: [], stations: [], roundels: [], regions: [], elements: [], labels: [] };
  const TITLE = String(C.title || '').toUpperCase();
  P.texts.push({ t: titleDone, v: TITLE }, { t: titleDone, v: TITLE + '.' });
  P.texts.push({ t: T.title + 1.1, v: String(C.latin || '').toUpperCase() });
  P.texts.push({ t: T.gather[0] + 0.6, v: String(C.plate_no || '').toUpperCase() + '.' });
  P.texts.push({ t: T.gather[0] + 1.0, v: String(C.series || '').toUpperCase() });
  P.texts.push({ t: T.landing[0] + 0.8, v: C.caption || '' });
  P.elements.push({ t: T.build.ol[1], v: 'plant' }, { t: T.title, v: 'title' });
  P.elements.push({ t: B0, v: 'chart' }, { t: B1, v: 'rose' });
  P.elements.push({ t: T.gather[0], v: 'route' }, { t: T.gather[0], v: 'stations' });
  for (const d of dets) {
    P.roundels.push({ t: d.a.ring[0], v: d.i });
    P.labels.push({ t: d.labT.latin[1], v: d.lab.latin });
    P.texts.push({ t: d.labT.name[1], v: d.lab.name });
    const el = FOCUS_EL[d.focus]; if (el) P.elements.push({ t: d.a.ring[0], v: el });
  }
  for (const st of STATIONS) {
    P.stations.push({ t: st.n1, v: st.key });                  // the key is the language-independent anchor
    P.texts.push({ t: st.n1, v: st.label });                   // the plate carries exactly this string, no other
  }
  for (const name of cOrder) if (dropT[name] != null) P.regions.push({ t: dropT[name], v: name });
  PROBE = P;

  // ------------------------------------------------------------------ subtitle windows (the real voice windows, not the cue times)
  LINES.length = 0;
  for (const [id, anchors] of lineSpec(C, stName)) {
    const v = vo.find(x => x.id === id); if (!v) continue;
    LINES.push({ id, t0: v.t0, t1: v.t1, text: v.text, anchors });
  }

  // ------------------------------------------------------------------ render
  function applyCam(ctx, c, pre = null) { ctx.setTransform(1, 0, 0, 1, 0, 0); if (pre) ctx.transform(...pre); ctx.translate(W / 2, H / 2); ctx.rotate(c.rot || 0); ctx.scale(c.z, c.z); ctx.translate(-c.cx, -c.cy); }

  function drawLeader(ctx, d, r, t) {
    const f = [d.f.x, d.f.y];
    let wp = null; if (d.wp) { const m = [(f[0] + r.x) / 2, (f[1] + r.y) / 2]; wp = [lerp(m[0], d.wp[0], r.travel), lerp(m[1], d.wp[1], r.travel)]; }
    const aim = wp || f, dx = aim[0] - r.x, dy = aim[1] - r.y, L = Math.hypot(dx, dy) || 1; if (L < r.r + 6 * S) return;
    const end = [r.x + dx / L * r.r, r.y + dy / L * r.r];
    ctx.save(); ctx.strokeStyle = PAL.ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 0.95 * S;
    ctx.beginPath(); ctx.moveTo(...f); if (wp) ctx.lineTo(...wp); ctx.lineTo(...end); ctx.stroke();
    ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(f[0], f[1], 1.7 * S, 0, 7); ctx.fill(); ctx.restore();
    const nxt = wp || end, ddx = nxt[0] - f[0], ddy = nxt[1] - f[1], LL = Math.hypot(ddx, ddy) || 1;
    engraveText(ctx, String(d.i + 1), f[0] + ddx / LL * 26 * S + (-ddy / LL) * 11 * S, f[1] + ddy / LL * 26 * S + (ddx / LL) * 11 * S + 5 * S, { size: 15 * S, italic: true, p: seg(t, d.a.travel[1] - 0.3, d.a.travel[1] + 0.2) });
  }

  function drawPaperScene(ctx, t, cam, { noColour = false, pre = null, inkOnly = false } = {}) {
    applyCam(ctx, cam, pre);
    if (!inkOnly) drawSheet(ctx, { W, H, plate: PLATE });
    if (!noColour) wash.draw(ctx, t);
    ink.draw(ctx, t);
    ci.draw(ctx, t);
    frameInk.draw(ctx, t);
    if (inkOnly) return;
    // titles
    const tt = T.title;
    engraveText(ctx, String(C.title || '').toUpperCase() + '.', W / 2, 132 * fy, { size: 50 * S, weight: 600, track: L.track.title, p: seg(t, tt, tt + 0.65) });
    // the binomial is Latin whatever the language version says, so it keeps the Latin face (L.fonts.latin)
    engraveText(ctx, C.latin || '', W / 2, 172 * fy, { size: 24 * S, italic: true, weight: 400, font: L.fonts.latin, track: L.track.latin, p: seg(t, tt + 0.35, tt + 1.1) });
    const tg = T.gather[0];
    engraveText(ctx, String(C.plate_no || '').toUpperCase() + '.', BORDER[2] - 16 * S, 116 * fy, { size: 22 * S, weight: 600, track: L.track.plateNo, align: 'right', p: seg(t, tg + 0.1, tg + 0.6) });
    engraveText(ctx, String(C.series || '').toUpperCase(), BORDER[0] + 16 * S, 112 * fy, { size: 13 * S, weight: 500, track: L.track.series, align: 'left', p: seg(t, tg + 0.2, tg + 1.0) });
    // the ports are named one by one, just before the voice names them.
    // ★ 底衬：海图上刻名本来就该压住岸线（把那一小块「擦亮」再刻字），这也是铜版画的写法。
    //   实测 KENYA 的环正落在红海西岸线上、名字被岸线穿过；JAVA 落在陆地排线上同样读不出。
    //   ⇒ 给需要避让的站点一块纸色底衬 + 可选纵向偏移。判定标准是「9 个刻名全部清晰可读」。
    const ST_LABEL = { kenya: { dy: 26, backing: true }, java: { dy: -18, backing: true } };
    for (const st of STATIONS) {
      const o = ST_LABEL[st.key] || {};
      const ly = st.y - 16 * S + (o.dy || 0) * S;
      if (o.backing) {
        // The backing has to be as wide as the name is cut, and measure() is the ruler engraveText itself uses
        // (it takes the same track). The 9.2-per-character estimate is a Latin one: a Chinese name is full-width,
        // so it is measured instead. Latin names keep the estimate, so the English plate does not move a pixel.
        const w = (isCJK(st.label) ? measure(ctx, st.label, { size: 13 * S, weight: 600, track: L.track.station }).tw : String(st.label).length * 9.2 * S) + 16 * S;
        ctx.save();
        ctx.globalAlpha = 0.92; ctx.fillStyle = PAL.paper;
        ctx.fillRect(st.x - w / 2, ly - 10 * S, w, 14 * S);
        ctx.restore();
      }
      engraveText(ctx, st.label, st.x, ly, { size: 13 * S, weight: 600, track: L.track.station, p: seg(t, st.n0, st.n1) });
    }
    // leaders under the roundels
    for (const d of dets) { const r = roundelAt(d, t); if (r && r.travel > 0) drawLeader(ctx, d, r, t); }
    // the margin labels stand inboard of their roundels, in the clear column the figure is scaled to leave.
    // They are cut before the roundel lands, so a roundel in flight covers its own label instead of crossing it.
    for (const d of dets) {
      const lc = d.labC, ly = d.slot[1], above = ly > H / 2;
      if (t <= d.labT.name[0]) continue;
      const nl = d._nl || (d._nl = wrapLines(ctx, d.lab.note, lc.w, { size: NOTE.size, font: L.fonts.script }));
      const A = labAnchor(ly, above, nl.length);
      engraveText(ctx, d.lab.name, lc.cx, A.name, { size: 16 * S, weight: 600, track: L.track.figName, p: seg(t, ...d.labT.name) });
      // the part names (corolla, drupa, semina, Mocha) are Latin in every language version: keep the Latin face
      engraveText(ctx, d.lab.latin, lc.cx, A.latin, { size: 19 * S, italic: true, weight: 400, font: L.fonts.latin, p: seg(t, ...d.labT.latin) });
      const np = seg(t, ...d.labT.note);
      nl.forEach((ln, q) => writeScript(ctx, ln, lc.cx, A.note0 + q * LEADN, { size: NOTE.size, p: clamp(np * nl.length - q) }));
    }
    // roundels
    dets.forEach((d, j) => {
      const r = roundelAt(d, t); if (!r) return;
      ctx.save(); ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.clip();
      ctx.globalAlpha = ss(r.burn);
      ctx.fillStyle = PAL.paper; ctx.fillRect(r.x - r.r, r.y - r.r, r.r * 2, r.r * 2);
      ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(paperTexture(W, H), 0, 0, W, H);
      ctx.globalAlpha = 0.55 * ss(r.burn); ctx.fillStyle = PAL.plateTone; ctx.fillRect(r.x - r.r, r.y - r.r, r.r * 2, r.r * 2);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.translate(r.x, r.y); const k = r.r / 500; ctx.scale(k, k);
      if (d.art.magnify) {
        const M = 500 / (d.f.r * 2.4), tb = t < d.a.cont[0] ? -99 : lerp(-2.7, 7.0, seg(t, ...d.a.cont));
        ctx.scale(M, M); ctx.translate(-d.f.x, -d.f.y);
        if (!noColour) wash.draw(ctx, t);
        ink.draw(ctx, tb, { wScale: 0.55 });
        ci.draw(ctx, tb, { wScale: 0.55 });
      } else {
        if (!noColour) dWash[j].draw(ctx, t);
        d.art.ink.draw(ctx, t, { wScale: Math.max(1, 0.55 / (k * cam.z)) ** 0.6 });
      }
      ctx.restore();
      roundelFrame(ctx, r.x, r.y, r.r, { p: r.ring, w: 2.0 * S });
    });
    // the caption is the chart's legend; the signatures close the plate
    const tl = T.landing[0];
    engraveText(ctx, C.caption || '', W / 2, 982 * fy, { size: 22 * S, italic: true, weight: 500, p: seg(t, tl + 0.05, tl + 0.8) });
    if (C.signature) {
      engraveText(ctx, C.signature.left || '', BORDER[0] + 4 * S, 1026 * fy, { size: 13 * S, italic: true, align: 'left', p: seg(t, tl + 1.0, tl + 1.4) });
      engraveText(ctx, C.signature.right || '', BORDER[2] - 4 * S, 1026 * fy, { size: 13 * S, italic: true, align: 'right', p: seg(t, tl + 1.2, tl + 1.6) });
    }
  }

  function screenOf(cam, x, y) { const m = new DOMMatrix().translateSelf(W / 2, H / 2).rotateSelf(cam.rot * 180 / Math.PI).scaleSelf(cam.z, cam.z).translateSelf(-cam.cx, -cam.cy); const p = m.transformPoint(new DOMPoint(x, y)); return [p.x, p.y]; }
  function drawCopperScene(ctx, t, cam) {
    applyCam(ctx, cam);
    Cu.drawCopper(ctx, [-300 * S, -300 * S, W + 300 * S, H + 300 * S]);
    // copperLight measures its parallax from the design centre (960, 540); hand it the camera as if the frame
    // were still the design frame, so the reflection slides with the camera on any shape of plate.
    Cu.copperLight(ctx, W, H, { ...cam, cx: cam.cx + (960 - W / 2), cy: cam.cy + (540 - H / 2) }); applyCam(ctx, cam);
    guide.draw(ctx, Infinity, { color: 'rgba(255,226,196,0.4)', wScale: 0.3, dx: -0.25, dy: -0.25 });
    guide.draw(ctx, Infinity, { color: 'rgba(60,24,8,0.25)', wScale: 0.2, dx: 0.2, dy: 0.2 });
    Cu.drawGrooves(ctx, ink, Math.min(t, T.lift + 0.001), { zoom: cam.z });
    const tp = tipAt(Math.min(t, T.lift)), sp = screenOf(cam, tp.x, tp.y), dv = [tp.dx * Math.cos(cam.rot) - tp.dy * Math.sin(cam.rot), tp.dx * Math.sin(cam.rot) + tp.dy * Math.cos(cam.rot)];
    const lift = ss(seg(t, T.lift, T.lift + 0.35));
    const cut = (Math.min(t, T.lift) + 1.6) * 150 * S;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    Cu.drawSwarf(ctx, sp, dv, cut, { s: 1.25 * S });
    Cu.drawBurin(ctx, sp, dv, { s: 1.1 * S, lift });
    ctx.restore();
  }

  function drawSubs(ctx, t) {
    const sb = subs.find(x => t >= x.t0 && t < x.t1); if (!sb) return;
    const a = Math.min(seg(t, sb.t0, sb.t0 + 0.25), 1 - seg(t, sb.t1 - 0.2, sb.t1));
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    const size = 38 * S, ls = wrapLines(ctx, sb.text, 860 * S, { size, font: L.fonts.script });
    const lh = size * 1.12, hgt = ls.length * lh + 24 * S, wid = Math.max(...ls.map(l => measure(ctx, l, { size, font: L.fonts.script, weight: 400 }).tw)) + 70 * S;
    const y1 = 1058 * fy, y0 = y1 - hgt, x0 = W / 2 - wid / 2;
    ctx.globalAlpha = a;
    ctx.shadowColor = 'rgba(60,40,20,0.28)'; ctx.shadowBlur = 14 * S; ctx.shadowOffsetY = 4 * S;
    ctx.fillStyle = '#f4eddb'; ctx.beginPath();
    const R = B.RNG(7); ctx.moveTo(x0, y0); for (let x = x0; x <= x0 + wid; x += 14 * S) ctx.lineTo(x, y0 + (R() - 0.5) * 2.2 * S); for (let y = y0; y <= y1; y += 12 * S) ctx.lineTo(x0 + wid + (R() - 0.5) * 2 * S, y); for (let x = x0 + wid; x >= x0; x -= 14 * S) ctx.lineTo(x, y1 + (R() - 0.5) * 2.2 * S); for (let y = y1; y >= y0; y -= 12 * S) ctx.lineTo(x0 + (R() - 0.5) * 2 * S, y); ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent';
    ls.forEach((ln, i) => writeScript(ctx, ln, W / 2, y0 + 12 * S + lh * (i + 0.8), { size, color: '#2b1e14', p: 1, alpha: a }));
    ctx.restore();
  }

  // ------------------------------------------------------------------ end card: a colophon cut into the lower margin
  // The tissue guard and the centred four lines are the library's own demo card; a user's film carries neither
  // our credit nor a copy of it (DEMO.md, "End card"). What closes this plate is a printer's colophon — film
  // title, style and credits typeset from content.json's `end` — cut into the blank lower margin, in the two
  // columns that flank the caption, the two signatures and the subtitle slip that already stand along the foot.
  function drawEnd(ctx, t) {
    const p = seg(t, T.end[0], T.end[0] + 0.7); if (p <= 0) return;
    const E = C.end || {};
    const e0 = T.end[0] + 0.25, q = (a, b) => seg(t, e0 + a, e0 + b);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    // left column: the plate's own name, over the name of the medium
    engraveText(ctx, String(E.film_title || C.title || '').toUpperCase(), 196 * fx, 974 * fy,
      { size: 25 * S, weight: 600, track: L.track.endTitle, align: 'left', p: q(0.1, 0.5) });
    writeScript(ctx, E.style_name || FILM_META.style, 196 * fx, 994 * fy, { size: 16 * S, align: 'left', p: q(0.4, 0.8) });
    // right column: the credits, one to a line
    (E.credits || []).forEach((c, i) => engraveText(ctx, c, 1690 * fx, 964 * fy + i * 17 * S,
      { size: 13 * S, weight: 500, track: L.track.credit, align: 'right', p: q(0.45 + i * 0.09, 0.85 + i * 0.09) }));
    ctx.restore();
  }

  function render(ctx, t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    const cam = camAt(t);
    if (t < T.peel[0]) drawCopperScene(ctx, t, cam);
    else if (t < T.peel[1]) drawPeel(ctx, t, cam);
    else drawPaperScene(ctx, t, cam);
    // print finish: a warm vignette
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (t >= T.peel[0]) { const vg = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.55, W / 2, H / 2, H * 1.15); vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(1, 'rgba(120,86,46,0.2)'); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    if (t >= T.peel[1] && !(typeof location !== 'undefined' && location.search.includes('nosub'))) drawSubs(ctx, t);
    drawEnd(ctx, t);
  }

  // the proof is pulled: the sheet peels back across the frame. Behind the fold, the printed face; ahead of it, the copper;
  // on the fold, the curling sheet shows its back with the print showing through, mirrored.
  function drawPeel(ctx, t, cam) {
    // the fold sweeps the whole frame, so its travel and the band's over-length follow the frame's own size
    const BL = Math.max(fx, fy), span = 2700 * (Math.hypot(W, H) / Math.hypot(NATIVE.W, NATIVE.H));
    const u = ss(seg(t, ...T.peel)) * 0.7 + seg(t, ...T.peel) * 0.3, dir = [0.8, 0.6], off = lerp(-span / 2 - 260 * BL, span / 2 + 260 * BL, u);
    const c = [W / 2 - dir[0] * off, H / 2 - dir[1] * off], n = [-dir[1], dir[0]], fw = 380 * S;
    const band = (d0, d1) => { const A = [c[0] + dir[0] * d0, c[1] + dir[1] * d0], Bp = [c[0] + dir[0] * d1, c[1] + dir[1] * d1]; ctx.beginPath(); ctx.moveTo(A[0] + n[0] * 3000 * BL, A[1] + n[1] * 3000 * BL); ctx.lineTo(A[0] - n[0] * 3000 * BL, A[1] - n[1] * 3000 * BL); ctx.lineTo(Bp[0] - n[0] * 3000 * BL, Bp[1] - n[1] * 3000 * BL); ctx.lineTo(Bp[0] + n[0] * 3000 * BL, Bp[1] + n[1] * 3000 * BL); ctx.closePath(); };
    drawCopperScene(ctx, t, cam);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); band(0, 4000 * BL); ctx.clip(); drawPaperScene(ctx, t, cam, { noColour: true }); ctx.restore();
    // shadow of the lifted sheet on the copper
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); band(-fw * 0.9, -fw * 2.2); ctx.clip();
    const sg = ctx.createLinearGradient(c[0] - dir[0] * fw * 0.9, c[1] - dir[1] * fw * 0.9, c[0] - dir[0] * fw * 2.2, c[1] - dir[1] * fw * 2.2); sg.addColorStop(0, 'rgba(30,10,2,0.6)'); sg.addColorStop(1, 'rgba(30,10,2,0)'); ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H); ctx.restore();
    // the flap: mirror of the paper just behind the fold, seen from its back
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); band(0, -fw); ctx.clip();
    ctx.fillStyle = '#efe6d0'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(paperTexture(W, H), 0, 0, W, H); ctx.globalCompositeOperation = 'source-over';
    const dx = dir[0], dy = dir[1], cd = c[0] * dx + c[1] * dy, M = [1 - 2 * dx * dx, -2 * dx * dy, -2 * dx * dy, 1 - 2 * dy * dy, 2 * cd * dx, 2 * cd * dy];
    ctx.globalAlpha = 0.28; ctx.filter = 'blur(0.8px)';
    drawPaperScene(ctx, t, cam, { noColour: true, pre: M, inkOnly: true });
    ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fg = ctx.createLinearGradient(c[0], c[1], c[0] - dir[0] * fw, c[1] - dir[1] * fw);
    // the sheet bends like a cylinder: a dark crease at the fold, a bright roll, then it turns away from the light
    fg.addColorStop(0, 'rgba(70,52,28,0.55)'); fg.addColorStop(0.06, 'rgba(120,96,60,0.2)'); fg.addColorStop(0.22, 'rgba(255,252,242,0.55)'); fg.addColorStop(0.5, 'rgba(255,255,255,0.05)'); fg.addColorStop(0.85, 'rgba(120,96,60,0.25)'); fg.addColorStop(1, 'rgba(80,60,34,0.45)');
    ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = 'rgba(80,60,34,0.5)'; ctx.lineWidth = 1.4; band(-fw, -fw - 0.01); ctx.stroke(); ctx.restore();
  }

  // ------------------------------------------------------------------ events (sound cues) for the mixer
  const EV = [];
  EV.push({ t: 0, type: 'burin', until: T.lift });
  EV.push({ t: T.lift, type: 'lift' });
  EV.push({ t: T.peel[0] - 0.25, type: 'press' }, { t: T.peel[0], type: 'peel' });
  EV.push({ t: T.build.ol[0], type: 'hatch', until: T.build.h3[1] });
  for (const g of ['ol', 'h1', 'h2', 'h3']) EV.push({ t: T.build[g][0], type: 'pass', g });
  EV.push({ t: T.title, type: 'title', n: [...String(C.title || '')].length + 1, dur: 0.9 });
  for (const d of dets) EV.push({ t: d.a.push[0], type: 'push', i: d.i, role: d.role, dur: d.D }, { t: d.a.ring[0], type: 'ring', i: d.i }, { t: d.a.burn[0], type: 'burnish', i: d.i }, { t: d.a.cont[0], type: 'cut', until: d.a.cont[1], i: d.i }, { t: d.a.travel[0], type: 'travel', until: d.a.travel[1], i: d.i }, { t: d.a.travel[1], type: 'land', i: d.i }, { t: d.labT.name[0], type: 'letters', dur: 0.6 }, { t: d.labT.note[0], type: 'quill', dur: 1.1, i: d.i });
  EV.push({ t: T.gather[0], type: 'natsize' }, { t: T.silence[0], type: 'silence', until: T.silence[1] });
  cOrder.forEach((name, k) => EV.push({ t: c0 + k * 0.42, type: 'drop', region: name }));
  EV.push({ t: T.landing[0], type: 'landing' }, { t: T.landing[0] + 0.05, type: 'letters', dur: 0.75 }, { t: T.landing[0] + 1.0, type: 'dot' }, { t: T.landing[0] + 1.2, type: 'dot' }, { t: T.end[0] - 0.2, type: 'tissue' });
  vo.forEach(v => EV.push({ t: v.t0, type: 'vo', id: v.id, dur: v.t1 - v.t0 }));
  EV.sort((a, b) => a.t - b.t);

  return { render, DUR, T, EV, subs, dets, cam: camAt };
}
