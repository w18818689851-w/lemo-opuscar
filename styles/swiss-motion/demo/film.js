// Five Rules for a Poster —— 时间线与绘制。所有坐标都在网格上；所有运动都是 snap（精确缓动）或 lin（线性）。
// 唯一例外：红圆出走（线性、不吸附、离开网格）。
import { clamp, lerp, seg, E, snap, lin, steps, track, E8, E16, BEAT, BAR } from './ease.js';

// 帧尺寸不是常量：渲染器截的是浏览器**视口**，`--size/--ratio` 会改它。NATIVE 是设计帧（1920×1080）。
// layout(W,H) 从**实际拿到的帧**重新推导整个版面（规则见下）：位置按轴拉伸（×fx / ×fy）、尺寸按紧轴
// 缩放（×S）。派生值集中在这里，绘制点只读不重算。1920×1080 时 fx = fy = S = 1，每个表达式都退化成
// 它替换掉的那个数字 ⇒ 16:9 逐字节不变。顶层不许算几何：W/H 只在 layout() 里被赋值。
export const NATIVE = { W: 1920, H: 1080 }, DUR = 44;
export let W = NATIVE.W, H = NATIVE.H, fx = 1, fy = 1, S = 1;
export const C = {
  page: '#EAE9E5', paper: '#FFFFFF', ink: '#111111', red: '#E30613',
  grid: '#CFCEC9', pgrid: '#E2E1DC', bass: '#CFCEC9', mute: '#77766F', col: '#E2E1DC', wall: '#DFDED9',
};
// ---------- 画面网格：12 列，边距 96，栏距 24（随帧宽拉伸，12 列永远铺满整幅）----------
let FM = 96, FG = 24, FC = 122;
export const col = i => FM + i * (FC + FG);
// ---------- 海报（局部坐标）：706×1008；7 列 × 91 = A 多利亚 7 个音；16 行 × 40 = 16 个八分音符 ----------
// 海报是**固定尺寸的物件**（自己的坐标系），由机位摆放/缩放；它内部这套局部几何不随帧变。
export const PW = 706, PH = 1008, PM = 35, PMX = 34.5, CW = 91, RH = 40, NC = 7;
export const px = c => PMX + c * CW, py = r => PM + r * RH;
const SCORE_B = py(16);

// FILM_META.aspects —— 这部影片**真的能正确构图**的输出比例清单（**字面量**：控制台按源码文本探测，不是求值，
// 见 D:\lemo-tools\lib\aspects.mjs）。不写 = 只支持 16:9（= 没改造过，按 1920×1080 绝对像素构图、给别的尺寸会被裁）。
// 这里能列出 9:16，是因为 renderFilm 从 opts.W/opts.H 经 layout() 重排了整个版面（见 layout() 的说明）。
export const FILM_META = { id: 'five-rules', title: 'Five Rules for a Poster', style: 'Swiss Motion Graphics', aspects: ['16:9', '9:16'] };

// ---------- 关键时刻 ----------
export const T = {
  run: 18.0, circleIn: 20.0, hes: 23.5, pageOut: 24.5, fly0: 24.5, pause: [25.0, 25.25], land: 26.0,
  reflow: 26.125, txtFinal: 27.125, gridOff: 27.5, rot: 30.0, rotD: 1.5 * BEAT, labels: 30.5,
  sweep: 32.0, wall: 37.0, wallD: 1.0, cut: 39.0, home: 40.0,
};

let SCORE = null, WORDS = {}, LINES = [];
export function setScore(s) { SCORE = s; buildUnits(); }
export function setWords(w) { WORDS = w || {}; }
// 字幕 = 版面里的一行排版。第一句做小字（导语），其余做大字（陈述）
const LAYOUT = { l1: [7.8, 'page'], l2: [11.8, 'page'], l3: [15.8, 'page'], l4: [19.85, 'page'], l4b: [22.15, 'page', 1], l5: [99, 'page'], l5b: [27.4, 'center'], l6: [39.95, 'wall'] };
export function setLines(lines, dur) {
  LINES = lines.map(L => {
    const i = L.text.indexOf('. '), [end, pos, soft] = LAYOUT[L.id];
    const small = L.id === 'l5b' ? '' : L.text.slice(0, i + 1), big = L.id === 'l5b' ? L.text : L.text.slice(i + 2);
    return { id: L.id, t: L.t, dur: dur[L.id], end, pos, soft, small, big, text: L.text };
  });
}
export const subs = () => LINES.map(L => ({ t0: L.t, t1: Math.min(L.end, L.id === 'l5' ? 24.5 : L.end), text: L.text }));

// ======================================================================
function font(g, weight, size, fam = 'Archivo') {
  g.font = `${weight} ${size}px ${fam}`;
  g.letterSpacing = size >= 90 && fam === 'Archivo' ? `${(-size * 0.022).toFixed(1)}px` : '0px';
}
const textW = (g, s) => g.measureText(s).width;
// 从基线下方吸附出现的一段文字（p: 0→1 进入；q: 0→1 向上翻走）
function revealText(g, s, x, y, size, p, q = 0) {
  if (p <= 0 || q >= 1) return;
  const w = textW(g, s) + size * .1;
  g.save(); g.beginPath(); g.rect(x - 2, y - size * 1.02, w + 4, size * 1.30); g.clip();
  g.fillText(s, x, y + (1 - p) * size * 1.05 - q * size * 1.3);
  g.restore();
}
function wordTimes(L) {
  const n = (L.small ? L.small.split(' ').length : 0) + L.big.split(' ').length, w = WORDS[L.id];
  if (w && w.length === n) return w.map(x => L.t + x);
  return Array.from({ length: n }, (_, i) => L.t + i * .26);
}
function drawLine(g, L, t, x, ySmall, yBig, bigSize = 76) {
  if (t < L.t - .1 || t > L.end + .2) return;
  const ts = wordTimes(L), sm = L.small ? L.small.split(' ') : [], bg = L.big.split(' ');
  const q = snap(t, L.end, E8), sSm = 30 * S, sBg = bigSize * S;
  let i = 0, cx = x;
  font(g, 500, sSm); g.fillStyle = C.mute;
  for (const wd of sm) { revealText(g, wd, cx, ySmall, sSm, snap(t, ts[i] + E16, E16), q); cx += textW(g, wd + ' '); i++; }
  cx = x; font(g, L.soft ? 400 : 700, sBg); g.fillStyle = C.ink;
  for (const wd of bg) { revealText(g, wd, cx, yBig, sBg, snap(t, ts[i] + E16, E16), q); cx += textW(g, wd + ' '); i++; }
}

// ======================================================================
// 海报文字块：A 杂乱（三种字体）→ B 统一 Archivo → C 留白压缩 → D 齐左 → E 最终
const TX = [
  { A: ['Neue Musik', 'Fraktur', 400, 118, 200], B: ['neue musik', 800, 112], C: [104, 800, 790], E: [PMX, 861, 150, 800], split: [PMX, 973] },
  { A: ['Grosses Konzert', 'DMSerif', 400, 62, 300], B: ['grosses konzert', 300, 62], cut: 14.0 },
  { A: ['!! nicht verpassen !!', 'Archivo', 800, 40, 370], B: ['!! nicht verpassen !!', 900, 40], cut: 12.5 },
  { A: ['Konzert 1961', 'DMSerif', 400, 58, 452], B: ['konzert 1961', 600, 58], C: [32, 600, 842], E: [px(3), 64, 32, 700] },
  { A: ['Freitag 17. März 1961 · 20.15 Uhr', 'Archivo', 400, 28, 520], B: ['freitag 17. märz 1961 · 20.15 uhr', 400, 28], C: [20, 400, 888], E: [px(3), 104, 20, 500] },
  { A: ['im Kleinen Saal', 'Fraktur', 400, 54, 600], B: ['kleiner saal', 700, 54], C: [20, 400, 914], E: [px(3), 130, 20, 500] },
  { A: ['mit Pauken und Trompeten', 'DMSerif', 400, 42, 680], B: ['mit pauken und trompeten', 500, 42], cut: 13.0 },
  { A: ['Werke von Marti, Brunner, Weiss', 'Archivo', 400, 24, 748], B: ['werke von marti, brunner, weiss', 400, 24], C: [20, 400, 940], E: [px(3), 156, 20, 400] },
  { A: ['Eintritt Fr. 3.–', 'DMSerif', 400, 36, 820], B: ['eintritt fr. 3.–', 600, 36], C: [20, 400, 966], E: [px(3), 182, 20, 400] },
  { A: ['— Nur ein Abend —', 'Fraktur', 400, 44, 900], B: ['nur ein abend', 800, 44], cut: 13.5 },
];
const T_TXT_IN = 8.0, T_FONT = 10.0, T_COMPACT = 15.0, T_ALIGN = 16.0;
const TXC = TX.filter(z => z.C);
function drawPosterText(g, t) {
  if (t < T_TXT_IN) return;
  TX.forEach((d, i) => {
    const pin = snap(t, T_TXT_IN + i * E16 + E16, E16);
    if (pin <= 0) return;
    const useB = t >= T_FONT;
    let text = useB ? d.B[0] : d.A[0], fam = useB ? 'Archivo' : d.A[1], wt = useB ? d.B[1] : d.A[2];
    let size = useB ? d.B[2] : d.A[3], y = d.A[4], collapse = 1, xl = null;
    if (d.cut) { if (t > d.cut + E8) return; collapse = 1 - snap(t, d.cut + E8, E8); }
    if (d.C) {
      const kc = TXC.indexOf(d), pc = snap(t, T_COMPACT + kc * E16 * .5, E8 * 2);
      size = lerp(size, d.C[0], pc); y = lerp(y, d.C[2], pc); if (pc > .5) wt = d.C[1];
      font(g, wt, size, fam);
      xl = lerp(PW / 2 - textW(g, text) / 2, PMX, snap(t, T_ALIGN, E8 * 2));
      const pf = snap(t, T.txtFinal + kc * E16, E8);
      if (pf > 0) { xl = lerp(xl, d.E[0], pf); y = lerp(y, d.E[1], pf); size = lerp(size, d.E[2], pf); if (pf > .5) wt = d.E[3]; }
    }
    font(g, wt, size, fam); g.fillStyle = C.ink;
    if (d.split && t >= T.txtFinal - E8) {      // 标题拆成两行：musik 落到第二行
      const pf = snap(t, T.txtFinal, E8), w1 = text.split(' ')[0];
      const x2 = lerp(xl + textW(g, w1 + ' '), d.split[0], pf), y2 = lerp(y, d.split[1], snap(t, T.txtFinal + E16, E8));
      g.fillText(w1, xl, y); g.fillText(text.slice(w1.length + 1), x2, y2);
      return;
    }
    const w = textW(g, text), x0 = xl ?? (PW / 2 - w / 2);
    g.save();
    if (collapse < 1) { const m = y - size * .35; g.translate(0, m); g.scale(1, Math.max(.001, collapse)); g.translate(0, -m); }
    g.beginPath(); g.rect(x0 - 10, y - size * 1.1, w + 20, size * 1.45 * pin); g.clip();
    g.fillText(text, x0, y);
    g.restore();
    if (d.cut && t > d.cut - E16 && t < d.cut + E8) {   // 刀线
      g.fillStyle = C.ink; g.fillRect(PMX - 10, y - size * .35 - 1, (PW - 2 * PMX + 20) * lin(t, d.cut - E16, d.cut), 2);
    }
  });
}

// ======================================================================
// 乐谱单元：16 个一格长的黑块，从呆板阶梯 → 最终乐句（相邻格合并成长条；首条出血到上边，末条出血到右边）
let UNITS = [];
function buildUnits() {
  const slots = [];
  SCORE.final.lead.forEach(([c, r, l], bi) => { for (let j = 0; j < l; j++) slots.push({ c, r: r + j, first: j === 0, last: j === l - 1, bar: bi }); });
  slots.sort((a, b) => a.r - b.r || a.c - b.c);
  const [fcx, fcy] = circleFinalCenter();
  UNITS = SCORE.stiff.lead.map(([c, r], k) => ({ s: { c, r }, f: slots[k] }));
  UNITS.map((u, k) => [k, Math.hypot(px(u.s.c) + CW / 2 - fcx, py(u.s.r) + RH / 2 - fcy)]).sort((a, b) => a[1] - b[1]).forEach(([k], rank) => UNITS[k].rank = rank);
}
function rectOf(c, r, first = true, last = true, bar = -1) {
  let x0 = px(c) + 4, x1 = px(c) + CW - 4, y0 = first ? py(r) + 3 : py(r) - 1, y1 = last ? py(r + 1) - 3 : py(r + 1) + 1;
  const bl = SCORE.final.bleed && SCORE.final.bleed[bar];
  if (bl === 'top' && first) y0 = -2;
  if (bl === 'right') x1 = PW + 2;
  return [x0, y0, x1 - x0, y1 - y0];
}
const barOn = (bar, row) => { const b = SCORE.final.lead[bar]; return row >= b[1] && row < b[1] + b[2]; };
function drawUnits(g, t, playRow) {
  for (let k = 0; k < UNITS.length; k++) {
    const u = UNITS[k], pin = snap(t, T.run + k * E16 + E16, E16);
    if (pin <= 0) continue;
    let R = rectOf(u.s.c, u.s.r);
    const pf = snap(t, T.reflow + Math.floor(u.rank / 2) * E16, E8);
    if (pf > 0) { const F = rectOf(u.f.c, u.f.r, u.f.first, u.f.last, u.f.bar); R = R.map((v, j) => lerp(v, F[j], pf)); }
    g.fillStyle = playRow != null && barOn(u.f.bar, playRow) ? C.red : C.ink;
    g.fillRect(R[0], R[1], R[2], R[3] * pin);
  }
}
function drawBass(g, t) {
  const p0 = lin(t, 16.0, 17.0);
  if (p0 <= 0) return;
  [[0, 0, 8], [0, 8, 4], [0, 12, 4]].forEach(([c, r, l], i) => {
    const [fc, fr, fl] = SCORE.final.bass[i], q = snap(t, T.reflow + E8 + i * E8, E8);
    const cc = lerp(c, fc, q), rr = lerp(r, fr, q), ll = lerp(l, fl, q);
    const y0 = py(rr), y1 = Math.min(py(rr + ll), PM + (SCORE_B - PM) * p0);
    if (y1 > y0) { g.fillStyle = C.bass; g.fillRect(px(cc), y0, CW, y1 - y0); }
  });
}

// ======================================================================
// 红圆：呆板位 = 右上角格子（2 列直径）；最终 = 左下、4 列直径、出血到左边、被标题压住
const D0 = () => CW * SCORE.circleDiameterCols.stiff, D1 = () => CW * SCORE.circleDiameterCols.final;
function circleFinalCenter() { const [c, r] = SCORE.final.circle, d = CW * SCORE.circleDiameterCols.final; return [px(c) + d / 2, py(r) + d / 2]; }
export function flight(t) { return lin(t, T.fly0, T.pause[0]) * .4 + lin(t, T.pause[1], T.land) * .6; }
export function circleState(t) {   // → [left, top, d]（海报局部像素）
  const [c0, r0] = SCORE.stiff.circle, [c1, r1] = SCORE.final.circle, d0 = D0(), d1 = D1();
  let x0 = px(c0) + .25 * CW * (snap(t, T.hes, E16) - snap(t, T.hes + .375, E16)), y0 = py(r0);
  y0 = lerp(-d0 - 4, y0, snap(t, T.circleIn, BEAT));     // 进场：从海报上边沿着自己的列落下
  const a = flight(t), d = lerp(d0, d1, a);
  const cx = lerp(x0 + d0 / 2, px(c1) + d1 / 2, a), cy = lerp(y0 + d0 / 2, py(r1) + d1 / 2, a);
  return [cx - d / 2, cy - d / 2, d];
}
function drawCircle(g, t, pulse) {
  if (t < T.circleIn - BEAT) return;
  const [l, tp, d] = circleState(t), cx = l + d / 2, cy = tp + d / 2;
  if (t > T.fly0 && t < T.gridOff + E8) {      // 离开后留下的空格与轨迹（1.5 px 红线）
    const [c0, r0] = SCORE.stiff.circle, d0 = D0(), gx = px(c0) + d0 / 2, gy = py(r0) + d0 / 2;
    const k = 1 - snap(t, T.gridOff + E8, E8);
    g.strokeStyle = C.red; g.lineWidth = 1.5;
    g.beginPath(); g.arc(gx, gy, d0 / 2 * k, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(lerp(gx, cx, 1 - k), lerp(gy, cy, 1 - k)); g.lineTo(cx, cy); g.stroke();
  }
  g.fillStyle = C.red; g.beginPath(); g.arc(cx, cy, d / 2, 0, Math.PI * 2); g.fill();
  if (pulse > 0 && pulse < 1) {    // 被播放线击中：一圈红线向外扩散
    g.strokeStyle = C.red; g.lineWidth = 6 * (1 - pulse);
    g.beginPath(); g.arc(cx, cy, d / 2 + 70 * E(pulse), 0, Math.PI * 2); g.stroke();
  }
}

// ======================================================================
// 海报网格线
function gridState(t) {
  const v = [], h = [];
  const off1 = seg(t, 20.0, 20.5), on2 = seg(t, 24.0, 24.5), off2 = seg(t, T.gridOff, T.gridOff + .5), off3 = seg(t, 36.0, 36.4);
  for (let c = 0; c <= NC; c++) {
    const p1 = lin(t, 4.0 + c * E8, 4.0 + c * E8 + E8), p3 = lin(t, T.rot + c * E16 * .5, T.rot + c * E16 * .5 + E8);
    v.push(t < 22 ? p1 * (1 - off1) : t < 29 ? on2 * (1 - off2) : p3 * (1 - off3));
  }
  for (let r = 0; r <= 16; r++) {
    const p1 = lin(t, 5.625 + r * E16, 5.625 + r * E16 + E8), p3 = lin(t, T.rot + .125 + r * E16 * .25, T.rot + .125 + r * E16 * .25 + E8);
    h.push(t < 22 ? p1 * (1 - off1) : t < 29 ? on2 * (1 - off2) : p3 * (1 - off3));
  }
  const ext = t < 29 ? E(on2) * (1 - E(off2)) : E(seg(t, T.rot, T.rot + .5)) * (1 - E(off3));
  return { v, h, ext };
}
function drawPosterGrid(g, t, G, stroke) {
  g.strokeStyle = stroke; g.lineWidth = 1; g.beginPath();
  const bOff = seg(t, 20.0, 20.5);
  if (t < 22) for (let k = 0; k <= 10; k++) {
    const p = lin(t, 7.0 + k * E16 * .5, 7.0 + k * E16 * .5 + E8) * (1 - bOff), y = 713 + k * 26 + .5;
    if (p > 0) { g.moveTo(PMX, y); g.lineTo(PMX + (PW - 2 * PMX) * p, y); }
  }
  G.v.forEach((p, c) => { if (p > 0) { g.moveTo(px(c) + .5, PM); g.lineTo(px(c) + .5, PM + (SCORE_B - PM) * p); } });
  G.h.forEach((p, r) => { if (p > 0) { g.moveTo(PMX, py(r) + .5); g.lineTo(PMX + (PW - 2 * PMX) * p, py(r) + .5); } });
  g.stroke();
}
function drawGridExt(g, G) {       // 网格延伸出海报、铺满画面
  if (G.ext <= 0) return;
  const L = 2600 * G.ext * Math.max(fx, fy);   // 网格要伸出海报铺满**当前**帧（竖屏更高，需要伸得更远）
  g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath();
  for (let c = 0; c <= NC; c++) { g.moveTo(px(c) + .5, 0); g.lineTo(px(c) + .5, -L); g.moveTo(px(c) + .5, PH); g.lineTo(px(c) + .5, PH + L); }
  for (let r = 0; r <= 16; r++) { g.moveTo(0, py(r) + .5); g.lineTo(-L, py(r) + .5); g.moveTo(PW, py(r) + .5); g.lineTo(PW + L, py(r) + .5); }
  g.stroke();
}

// ======================================================================
// 唯一的几何推导。位置按轴拉伸（×fx / ×fy）、尺寸按紧轴缩放（×S）：
//   · 12 列网格随帧宽铺满（FM/FG/FC × fx）；
//   · 机位（海报中心 cx/cy、缩放 s）随帧走 —— 海报永远落在画面里，不会跑出框外；
//   · 字号/线宽这类尺寸 × S，竖屏下字不糊也不溢出。
// 1920×1080 时 fx = fy = S = 1 ⇒ 全部退化成设计值，16:9 与改造前逐字节一致。
let SPREAD = null, CAM = null;
function layout(w, h) {
  W = w; H = h; fx = w / NATIVE.W; fy = h / NATIVE.H; S = Math.min(fx, fy);
  FM = 96 * fx; FG = 24 * fx; FC = 122 * fx;
  NUM_SIZE = Math.round(700 * S / NUM_ASC);
  SPREAD = [1471 * fx, 540 * fy, 1 * S, 0];
  CAM = track([
    [0, SPREAD],
    [T.pageOut, [860 * fx, 540 * fy, 1 * S, 0], BEAT],
    [T.rot, [960 * fx, 540 * fy, 1.34 * S, -Math.PI / 2], T.rotD],
    [T.wall, [960 * fx, 452 * fy, 0.42 * S, 0], T.wallD],
    [T.home, SPREAD, BEAT],
  ]);
}
export function posterMatrix(t) {
  const [cx, cy, s, r] = CAM(t);
  return new DOMMatrix().translate(cx, cy).rotate(r * 180 / Math.PI).scale(s).translate(-PW / 2, -PH / 2);
}

// ======================================================================
// 左页：巨大数字、规则注释、注释行、小节计数
const RULES = [[4.0, '1', 'Grid'], [8.0, '2', 'Typeface'], [12.0, '3', 'Space'], [16.0, '4', 'Alignment'], [22.0, '5', 'Exception']];
let NUM_SIZE = 980, NUM_ASC = 0.72;
export function measureNumeral(g) { font(g, 700, 100); NUM_ASC = g.measureText('4').actualBoundingBoxAscent / 100; NUM_SIZE = Math.round(700 / NUM_ASC); }
function drawNumeral(g, t) {
  const base = 1044 * fy, h = NUM_SIZE * NUM_ASC;
  for (let i = 0; i < RULES.length; i++) {
    const [tr, n] = RULES[i], tn = RULES[i + 1] ? RULES[i + 1][0] : 99;
    if (t < tr || t > tn + .01) continue;
    const up = steps(t, tr, tr + BEAT, 4), down = snap(t, tn, E8 * 2);
    g.save(); g.beginPath(); g.rect(0, base - h - 40 * S, 1100 * fx, h + 40 * S); g.clip();
    font(g, 700, NUM_SIZE); g.fillStyle = C.ink;
    const lsb = -g.measureText(n).actualBoundingBoxLeft;       // 光学左对齐
    g.fillText(n, col(0) - lsb, base + (1 - up) * (h + 40 * S) + down * (h + 40 * S));
    g.restore();
  }
}
const NOTES = [
  ['Columns 7', 'Rows 16', 'Module 91 × 40'],
  ['Family Archivo', 'Weights 400–800', 'Voices 1'],
  ['Lines removed 4', 'White space 62 %', ''],
  ['Axis flush left', 'Every edge on a line', ''],
  ['Exceptions 1', '', ''],
];
function drawRuleNotes(g, t) {
  const ri = RULES.findLastIndex(r => t >= r[0]); if (ri < 0) return;
  const tr = RULES[ri][0], tn = RULES[ri + 1] ? RULES[ri + 1][0] : 99, q = snap(t, tn, E8);
  font(g, 500, 19 * S); g.fillStyle = C.ink;
  NOTES[ri].forEach((s, i) => { if (s) revealText(g, s, col(4), 992 * fy + i * 26 * S, 19 * S, snap(t, tr + BEAT + i * E16, E16), q); });
  g.fillRect(col(4), 962 * fy, FC * 2 + FG, 1 * S);
}
function captionRow(g, x, p, q, a, b, c) {
  g.fillStyle = C.ink; g.fillRect(col(0) + x, 36 * fy, (col(5) + FC - col(0)) * p * (1 - q), 1 * S);
  font(g, 500, 19 * S);
  revealText(g, a, col(0) + x, 66 * fy, 19 * S, p, q); revealText(g, b, col(2) + x, 66 * fy, 19 * S, p, q); revealText(g, c, col(4) + x, 66 * fy, 19 * S, p, q);
}
function drawCaptions(g, t) {
  if (t < 2.0 || t > T.rot + .1) return;
  const p = snap(t, 2.0 + E8, E8), q = snap(t, T.rot - T.rotD + E8, E8);
  const ri = RULES.findLastIndex(r => t >= r[0]);
  if (ri < 0) captionRow(g, 0, p, q, 'A programme in five steps', '1961', '♩ = 120');
  else captionRow(g, 0, p, q, 'Five Rules for a Poster', `Rule 0${RULES[ri][1]} / 05`, RULES[ri][2]);
}
function drawBarCounter(g, t, pageX) {
  if (t < 4) return;
  const bar = Math.floor(t / BAR) + 1, beat = Math.floor((t % BAR) / BEAT) + 1;
  font(g, 500, 18 * S); g.fillStyle = C.mute; g.fillText('♩ = 120', col(6) + pageX, 1016 * fy);
  g.fillStyle = C.ink; font(g, 600, 18 * S); g.fillText(`bar ${String(bar).padStart(2, '0')}.${beat}`, col(6) + pageX, 1044 * fy);
}

// ======================================================================
// 开场：红线 + 网格列 + 片名
function drawOpening(g, t) {
  if (t > 8.3) return;
  const Y = 300 * fy;
  for (let c = 0; c < 12; c++) {     // 网格列：从红线处向上下同时长出（十六分音符一列）；规则一结束时收起
    const p = snap(t, .5 + c * E16 + E16, E16) * (1 - snap(t, 8.0 + (11 - c) * E16 * .25, E8));
    if (p > 0) { g.fillStyle = C.col; g.fillRect(col(c), Y - Y * p, FC, Y * p + (H - Y) * p); }
  }
  if (t > 4.2) return;
  const pr = lin(t, 0, .5), pout = snap(t, 4.0, E8 * 2);
  if (pr > 0 && pout < 1) { g.fillStyle = C.red; g.fillRect(W * pout, Y, W * (pr - pout), 3 * S); }
  const q = snap(t, 3.875 + E8, E8);
  font(g, 700, 120 * S); g.fillStyle = C.ink;
  let x = col(0); ['Five', 'Rules'].forEach((w, i) => { revealText(g, w, x, 168 * fy, 120 * S, snap(t, 2.0 + i * E8 + E16, E16), q); x += textW(g, w + ' '); });
  x = col(0); ['for', 'a', 'Poster'].forEach((w, i) => { revealText(g, w, x, 276 * fy, 120 * S, snap(t, 2.5 + i * E8 + E16, E16), q); x += textW(g, w + ' '); });
}

// ======================================================================
// 海报墙：同一套系统，每张打破一条不同的规则（叛逆元素都是红色）
const GAP = 80, SLOT = PW + GAP;
const VAR = [
  { k: -2, head: ['klang'], sub: 'konzert 1962', lead: [[0, 2, 2], [1, 4, 1], [2, 5, 3], [4, 8, 2], [5, 10, 1], [6, 11, 3]], bass: [[0, 0, 8], [4, 8, 8]], circ: [4, 1], rebel: 'typeface', label: 'breaks rule 2 · typeface' },
  { k: -1, head: ['takt'], sub: 'konzert 1963', lead: [[0, 0, 1], [1, 1, 1], [2, 2, 4], [3, 6, 1], [4, 7, 1], [5, 8, 4], [6, 12, 2]], bass: [[0, 0, 16]], circ: null, rebel: 'space', label: 'breaks rule 3 · space' },
  { k: 0, label: 'breaks rule 1 · grid', ours: true },
  { k: 1, head: ['stille'], sub: 'konzert 1964', lead: [[0, 0, 6], [3, 8, 1], [6, 12, 4]], bass: [[0, 6, 6]], circ: [4, 2], rebel: 'align', label: 'breaks rule 4 · alignment' },
  { k: 2, head: ['puls'], sub: 'konzert 1965', lead: [[0, 1, 2], [2, 3, 2], [1, 6, 3], [4, 7, 2], [3, 10, 3], [6, 12, 2]], bass: [[2, 0, 8], [5, 8, 8]], circ: [0, 11], rebel: 'all', label: 'breaks all five' },
];
function drawVariant(g, v) {
  g.save(); g.translate(v.k * SLOT, 0);
  g.fillStyle = C.paper; g.fillRect(0, 0, PW, PH);
  g.beginPath(); g.rect(0, 0, PW, PH); g.clip();
  const chaos = v.rebel === 'all';
  v.bass.forEach(([c, r, l]) => { g.fillStyle = C.bass; g.fillRect(px(c), py(r), CW, l * RH); });
  if (v.rebel === 'space') { g.fillStyle = C.red; g.fillRect(px(3), py(0), PW - px(3) + 2, py(8) - py(0)); }   // 空白被填满
  v.lead.forEach(([c, r, l], i) => {
    g.save();
    if (chaos) { g.translate(px(c) + CW / 2, py(r)); g.rotate((i % 2 ? .35 : -.25)); g.translate(-(px(c) + CW / 2), -py(r)); }
    g.fillStyle = C.ink; g.fillRect(px(c) + 4, py(r) + 3, CW - 8, l * RH - 6);
    g.restore();
  });
  if (v.circ) {
    const d = 2 * CW, [c, r] = v.circ;
    g.fillStyle = chaos ? C.red : C.ink;
    const ox = chaos ? 57 : 0, oy = chaos ? 23 : 0;
    g.beginPath(); g.arc(px(c) + d / 2 + ox, py(r) + d / 2 + oy, d / 2, 0, Math.PI * 2); g.fill();
  }
  // 标题
  const head = v.head[0];
  if (v.rebel === 'typeface') { font(g, 400, 190, 'Fraktur'); g.fillStyle = C.red; g.fillText('Klang', PMX, 960); }
  else if (chaos) {
    font(g, 400, 150, 'DMSerif'); g.fillStyle = C.ink; g.save(); g.translate(PW / 2, 900); g.rotate(-.12); g.textAlign = 'center'; g.fillText('Puls!', 0, 0); g.restore();
    font(g, 400, 60, 'Fraktur'); g.textAlign = 'center'; g.fillText('Konzert 1965', PW / 2, 990); g.textAlign = 'left';
  } else if (v.rebel === 'align') { font(g, 800, 170); g.fillStyle = C.red; g.fillText(head, PW - PMX - textW(g, head) + 6, 973); }   // 标题不齐左
  else { font(g, 800, 170); g.fillStyle = C.ink; g.fillText(head, PMX, 973); }
  // 信息块
  const info = [v.sub, 'freitag · 20.15 uhr', 'kleiner saal', 'eintritt fr. 3.–'];
  if (!chaos) info.forEach((s, i) => {
    font(g, i ? 500 : 700, i ? 20 : 32);
    let x = px(3), y = i ? 78 + i * 26 : 64;
    g.fillStyle = C.ink;
    g.fillText(s, x, y);
  });
  else { font(g, 700, 34, 'DMSerif'); g.fillStyle = C.ink; g.textAlign = 'center'; g.fillText('freitag 20.15 uhr', PW / 2 + 60, 120); g.textAlign = 'left'; }
  g.restore();
}
// 墙上的展签
function drawWallLabels(g, t, M) {
  if (t < T.wall || t > T.cut + .01) return;
  VAR.forEach((v, i) => {
    const q = M.transformPoint(new DOMPoint(v.k * SLOT, PH + 60));
    font(g, v.ours ? 700 : 500, 22 * S); g.fillStyle = v.ours ? C.red : C.ink;
    revealText(g, v.label, q.x, q.y + 20 * S, 22 * S, snap(t, T.wall + E8 + i * E16, E16), snap(t, T.cut, E8));
  });
}

// ======================================================================
// 片尾卡
function drawEndCard(g, t, opt = {}) {
  if (t < T.cut) return;
  if (t < T.home - E8) return;
  const p = snap(t, T.home + E8, E8);
  if (opt.poster) {      // 海报：片名做主标题
    captionRow(g, 0, 1, 0, 'Swiss Motion Graphics', 'A Lemo-Opuscar film', 'LemoLab \u00d7 Claude Opus 5.5');
    font(g, 700, 120 * S); g.fillStyle = C.ink; g.fillText('Five Rules', col(0), 168 * fy); g.fillText('for a Poster', col(0), 276 * fy);
    font(g, 500, 19 * S); ['Typeface Archivo', 'Score A dorian \u00b7 120 bpm', 'Grid 7 \u00d7 16'].forEach((s, i) => g.fillText(s, col(4), 992 * fy + i * 26 * S));
    g.fillRect(col(4), 962 * fy, FC * 2 + FG, 1 * S);
    return;
  }
  captionRow(g, 0, p, 0, 'Five Rules for a Poster', 'A Lemo-Opuscar film', '2026');
  font(g, 700, 120 * S); g.fillStyle = C.ink;
  let x = col(0); ['Swiss', 'Motion'].forEach((w, i) => { revealText(g, w, x, 168 * fy, 120 * S, snap(t, T.home + E8 + i * E8, E16)); x += textW(g, w + ' '); });
  x = col(0); revealText(g, 'Graphics', x, 276 * fy, 120 * S, snap(t, T.home + E8 + 2 * E8, E16));
  font(g, 600, 36 * S); revealText(g, 'LemoLab × Claude Opus 5.5', col(0), 372 * fy, 36 * S, snap(t, T.home + BEAT * 2, E16));
  font(g, 500, 19 * S); g.fillStyle = C.ink;
  ['Typeface Archivo', 'Score A dorian · 120 bpm', 'Voice Kokoro af_sarah'].forEach((s, i) => revealText(g, s, col(4), 992 * fy + i * 26 * S, 19 * S, snap(t, T.home + BEAT * 3 + i * E16, E16)));
  g.fillRect(col(4), 962 * fy, (FC * 2 + FG) * snap(t, T.home + BEAT * 3, E8), 1 * S);
}

// ======================================================================
// 主渲染
export function renderFilm(g, t, opt = {}) {
  layout(opt.W ?? NATIVE.W, opt.H ?? NATIVE.H);      // 唯一的几何推导：版面从这里按实际帧重排
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.page; g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  drawOpening(g, t);

  const pageX = -1200 * fx * snap(t, T.pageOut, BEAT);
  if (pageX > -1190 * fx) {
    g.save(); g.translate(pageX, 0);
    drawNumeral(g, t); drawRuleNotes(g, t);
    for (const L of LINES) if (L.pos === 'page') drawLine(g, L, t, col(0), 168 * fy, 252 * fy);
    g.restore();
    drawBarCounter(g, t, pageX);
  }
  drawCaptions(g, t);
  if (t >= T.home - BEAT) { g.fillStyle = C.red; g.fillRect(0, lerp(452, 300, snap(t, T.home, BEAT)) * fy, W, 3 * S); }   // 红线落到片名线（在海报后面）

  if (t >= 3.5 - E8) {
    const M = posterMatrix(t);
    g.setTransform(M);
    // 海报墙（拉远时才出现；39.0 被红线裁掉）
    if (t > 36.0 && t < T.home) {
      const cutX = lin(t, T.cut, T.cut + .5) * W;
      {   // 墙板：红线划过的地方被裁掉（屏幕空间里从左往右）
        const a = M.transformPoint(new DOMPoint(-2 * SLOT - 120, -110)), b = M.transformPoint(new DOMPoint(2 * SLOT + PW + 120, PH + 110));
        const x0 = Math.max(Math.min(a.x, b.x), t > T.cut ? cutX : -1e9), x1 = Math.max(a.x, b.x);
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (Math.abs(M.b) < 1e-6 && x1 > x0) { g.fillStyle = C.wall; g.fillRect(x0, Math.min(a.y, b.y), x1 - x0, Math.abs(b.y - a.y)); }
        else if (Math.abs(M.b) >= 1e-6) { g.setTransform(M); g.fillStyle = C.wall; g.fillRect(-2 * SLOT - 120, -110, 4 * SLOT + PW + 240, PH + 220); }
        g.setTransform(M);
      }
      for (const v of VAR) {
        if (v.ours) continue;
        const sx = M.transformPoint(new DOMPoint(v.k * SLOT + PW / 2, PH / 2)).x;
        const tc = T.cut + .5 * clamp(sx / W), k = 1 - snap(t, tc + E8, E8);
        if (k <= 0) continue;
        g.save(); g.translate(0, PH / 2); g.scale(1, k); g.translate(0, -PH / 2); drawVariant(g, v); g.restore();
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = C.red; if (t > T.cut && t < T.home - BEAT) g.fillRect(0, 452 * fy, cutX, 3 * S);
      g.setTransform(M);
    }
    const G = gridState(t);
    drawGridExt(g, G);
    const pin = snap(t, 3.5, E8);
    g.fillStyle = C.paper; g.fillRect(0, 0, PW, PH * pin);
    g.save(); g.beginPath(); g.rect(0, 0, PW, PH * pin); g.clip();
    drawPosterGrid(g, t, G, t < 21 ? '#C9C8C2' : C.pgrid);
    drawBass(g, t);
    const playRow = (t >= T.sweep && t < T.sweep + 4) ? (t - T.sweep) / E8 : null;
    drawUnits(g, t, playRow);
    const cr = SCORE.final.circle[1];
    drawCircle(g, t, playRow != null ? seg(playRow, cr, cr + 4) : 0);
    drawPosterText(g, t);
    g.restore();
    // 播放线：31.75 竖直画出，32–36 线性扫过，36 收起
    const ph = seg(t, T.sweep - BEAT / 2, T.sweep) * (1 - seg(t, T.sweep + 4, T.sweep + 4 + E8));
    if (ph > 0) {
      const row = clamp((t - T.sweep) / E8, 0, 16);
      g.fillStyle = C.red; g.fillRect(-24, py(row) - 2, (PW + 48) * ph, 4);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    drawScoreLabels(g, t, M);
    drawWallLabels(g, t, M);
  }
  drawHUD(g, t);
  drawEndCard(g, t, opt);
  if (!opt.nosub) for (const L of LINES) {
    if (L.pos === 'center') drawLine(g, L, t, col(0), 780, 848);
    if (L.pos === 'wall') drawLine(g, L, t, col(0), 928, 1004);
  }
}

// 旋转揭示后的音名与小节号（直立文字，画在屏幕坐标里）
function drawScoreLabels(g, t, M) {
  const q = snap(t, 36.0 + E8, E8);
  if (t < T.labels || q >= 1) return;
  const used = new Set(SCORE.final.lead.map(n => n[0]));
  font(g, 700, 26 * S);
  for (let c = 0; c < NC; c++) {
    const pt = M.transformPoint(new DOMPoint(px(c) + CW / 2, -22));
    g.fillStyle = used.has(c) ? C.ink : C.mute;
    revealText(g, SCORE.cols[c], pt.x - textW(g, SCORE.cols[c]) - 6 * S, pt.y + 9 * S, 26 * S, snap(t, T.labels + E16 + c * E16 * .5, E16), q);
  }
  font(g, 600, 22 * S);
  [0, 8].forEach((r, i) => {
    const pt = M.transformPoint(new DOMPoint(PW + 16, py(r)));
    g.fillStyle = C.ink; revealText(g, `bar ${i + 1}`, pt.x, pt.y - 10 * S, 22 * S, snap(t, T.labels + BEAT + i * E8, E16), q);
  });
}
// 出走时的坐标读数（贴近海报右边）
function drawHUD(g, t) {
  const p = snap(t, T.fly0, E8) * (1 - snap(t, T.gridOff + E8, E8));
  if (p <= 0) return;
  const [l, tp] = circleState(t), c = (l - PMX) / CW, r = (tp - PM) / RH;
  const on = t < T.fly0 + .01, x = 1290 * fx;
  font(g, 500, 26 * S); g.fillStyle = C.mute;
  revealText(g, 'col', x, 500 * fy, 26 * S, p); revealText(g, 'row', x, 540 * fy, 26 * S, p);
  font(g, 700, 26 * S); g.fillStyle = C.ink;
  revealText(g, (c < 0 ? '−' : '') + Math.abs(c).toFixed(2), x + 80 * fx, 500 * fy, 26 * S, p); revealText(g, r.toFixed(2), x + 80 * fx, 540 * fy, 26 * S, p);
  g.fillStyle = on ? C.ink : C.red; font(g, 700, 26 * S);
  revealText(g, on ? 'on grid' : 'off grid', x, 596 * fy, 26 * S, p);
  g.fillStyle = C.ink; g.fillRect(x, 460 * fy, 240 * fx * p, 1 * S);
}

// ======================================================================
// 音效事件（拟音），events.mjs 导出给 mix.py
export function buildEvents() {
  const ev = [], add = (t, type, o = {}) => ev.push({ t: +t.toFixed(4), type, ...o });
  add(0, 'knife', { g: 1 });
  for (let c = 0; c < 12; c++) add(.5 + c * E16 + E16 * .5, 'rule', { g: .5 });
  [2.0, 2.25, 2.5, 2.75, 3.0].forEach(t => add(t, 'clack', { g: .9 }));
  add(3.5, 'paper', { g: 1 });
  RULES.forEach(([tr]) => { for (let i = 1; i <= 4; i++) add(tr + i * BEAT / 4, 'thunk', { g: .45 + .15 * (i === 4) }); });
  for (let c = 0; c <= NC; c++) add(4.0 + c * E8 + E8, 'rule', { g: .7 });
  for (let r = 0; r <= 16; r++) add(5.625 + r * E16 + E8, 'rule', { g: .45 });
  for (let i = 0; i < TX.length; i++) add(T_TXT_IN + i * E16 + E16, 'clack', { g: .7 });
  add(T_FONT, 'clackBig', { g: 1 });
  TX.forEach(d => { if (d.cut) add(d.cut, 'knife', { g: .8 }); });
  TXC.forEach((d, k) => add(T_COMPACT + k * E16 * .5, 'slide', { g: .5 }));
  add(T_ALIGN, 'clackBig', { g: .9 }); add(16.0, 'slide', { g: .7 });
  for (let k = 0; k < 16; k++) add(T.run + k * E16 + E16, 'snap', { g: .5 });
  add(T.circleIn, 'thump', { g: 1 });
  add(T.hes + E16, 'tick', { g: .7 }); add(T.hes + .375 + E16, 'tick', { g: .6 });
  add(24.0, 'slide', { g: 1 });
  add(T.land, 'thump', { g: 1.1 });
  for (let i = 0; i < 8; i++) add(T.reflow + i * E16, 'snap', { g: .6 });
  TXC.forEach((d, k) => add(T.txtFinal + k * E16, 'clack', { g: .6 }));
  add(T.rot - T.rotD, 'swish', { g: 1, d: T.rotD });
  for (let c = 0; c < NC; c++) add(T.labels + E16 + c * E16 * .5, 'tick', { g: .35 });
  add(T.sweep - BEAT / 2, 'rule', { g: .8 });
  add(36.0, 'swish', { g: .8, d: 1.0 });
  add(T.cut, 'knife', { g: 1.1 });
  add(T.home - BEAT, 'swish', { g: .6, d: BEAT });
  for (let i = 0; i < 4; i++) add(T.home + E8 + i * E8, 'clack', { g: .7 });
  LINES.forEach(L => add(L.t, 'voice', { id: L.id }));
  return ev.sort((a, b) => a.t - b.t);
}
