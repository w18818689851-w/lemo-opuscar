// Magnified details for the coffee plate — four roundels, each drawn inside a disc of radius 500
// local units centred on (0,0); film.js scales them into a roundel of world radius 120, so every
// line here is drawn roughly four times heavier than on the plate itself.
//
// DETAILS = { flower, cherry, seed, harbour }   buildDetail(name) → { ink, regions, specimen, noRule }
//   ink groups: 'ol' (outlines), 'h1' 'h2' 'h3' (hatching), 'rule' (the ruling machine's ground).
//   regions reuse the main figure's colour-area names (leaf / flower / cherry / stem / bean);
//   the harbour inset is pure line, so it returns no regions.
import * as B from '../engine/burin.js';
const { ring, clamp, sstep, sphereTone, hatch, outline, stroke, stipple, RNG, noise1, noise2, ellipsePts, ellipse, inPoly } = B;

const L = { x: -0.55, y: -0.62, z: 0.56 }, LV = [L.x, L.y];
const TAU = Math.PI * 2, D2R = Math.PI / 180;

export const DETAILS = { flower: buildFlower, cherry: buildCherry, seed: buildSeed, harbour: buildHarbour };
export function buildDetail(name, o = {}) { return (DETAILS[name] || buildFlower)(o); }

// the ruling machine's ground: fine parallel lines laid across the disc, stopped at the specimen
function ruled(ink, excl, { spacing = 12, w = 1.5 } = {}) {
  ink.group('rule');
  const disc = ring(ellipsePts(0, 0, 486, 486, 0, 96));
  hatch(ink, disc.polys, { angle: 0, spacing, tone: () => 0.6, thr: 0, wMin: w, wMax: w, jitter: 0, wobble: 0.07, swell: 0, taper: 4, excl });
}

// a halo round the specimen so the ruled ground stands off it
function halo(polys, pad) {
  const bb = B.bboxOf(polys);
  return ring(ellipsePts((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, (bb[2] - bb[0]) / 2 + pad, (bb[3] - bb[1]) / 2 + pad, 0, 72)).polys;
}

// a spreading corolla lobe: t^0.5 (1-t)^0.45 peaks at t = 0.53 and is still half its width at
// t = 0.95, so the petal ends obtusely — a corolla lobe, not a leaf
const petalH = t => Math.pow(Math.max(1e-3, t), 0.5) * Math.pow(1 - t + 1e-3, 0.45) / 0.5206;
function petal(cx, cy, phi, r0, r1, halfMax, n = 34) {
  const ca = Math.cos(phi), sa = Math.sin(phi), pa = -sa, pb = ca, up = [], dn = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, r = r0 + (r1 - r0) * t, h = halfMax * petalH(t);
    const bx = cx + ca * r, by = cy + sa * r;
    up.push([bx + pa * h, by + pb * h]); dn.push([bx - pa * h, by - pb * h]);
  }
  return ring([...up, ...dn.reverse()]);
}

// ---------------------------------------------------------------------------- Fig. 1 · the flower
// One flower of Coffea arabica opened flat: five oblong white lobes, the throat, five stamens with
// their anthers, and the long style whose two-lobed stigma carries a few grains of its own pollen.
function buildFlower({ seed = 3 } = {}) {
  const ink = new B.Ink(), R = 432, r0 = 74;
  const lobes = [];
  for (let k = 0; k < 5; k++) {
    const phi = -Math.PI / 2 + 0.42 + k * TAU / 5;
    const lb = petal(0, 0, phi, r0, R, 118 * (1 + 0.05 * Math.sin(k * 2.1)));
    lobes.push(lb);
    ink.group('ol'); outline(ink, lb.polys[0], { w: 3.4, light: LV, vary: 0.9, seed: seed + k, run: 150, pinch: 0.5 });
    // the lobe's median vein — one, as a petal has
    ink.group('ol');
    {
      const ca = Math.cos(phi), sa = Math.sin(phi), pts = [];
      for (let i = 0; i <= 18; i++) { const t = i / 18 * 0.62, r = r0 + (R - r0) * t; pts.push([ca * r, sa * r]); }
      ink.add(pts, pts.map((_, i) => (0.5 + 1.8 * Math.sin(Math.PI * (0.06 + 0.88 * i / 18))) * 1.1));
    }
  }
  const allP = lobes.flatMap(lb => lb.polys);
  const ft = sphereTone(0, 0, R * 1.02, R * 1.02, { L, base: 0.0 });
  ink.group('h1'); hatch(ink, allP, { angle: 0.35, spacing: 10, tone: ft, thr: 0.30, wMax: 3.0, wMin: 0.75, seed: seed + 11, taper: 22, step: 3 });
  ink.group('h2'); hatch(ink, allP, { angle: -0.75, spacing: 12, tone: ft, thr: 0.60, wMax: 2.2, wMin: 0.75, seed: seed + 12, taper: 14, step: 3 });
  // the throat: a shallow cup with the stamens standing in it
  const thr0 = ellipse(0, 0, r0 * 1.02, r0 * 1.02, 0, 48);
  ink.group('ol'); outline(ink, thr0.polys[0], { w: 3.0, light: LV, vary: 0.8, seed: seed + 20, run: 90 });
  ink.group('h2'); hatch(ink, thr0.polys, { angle: 0.5, spacing: 7, tone: (x, y) => clamp(0.35 + 0.5 * (1 - clamp(Math.hypot(x, y) / r0))), thr: 0.2, wMax: 2.6, wMin: 0.8, seed: seed + 21, taper: 6, step: 2 });
  ink.group('ol');
  for (let k = 0; k < 5; k++) {
    const an = -Math.PI / 2 + (k + 0.5) * TAU / 5;
    const p0 = [Math.cos(an) * 34, Math.sin(an) * 34], p1 = [Math.cos(an) * 238, Math.sin(an) * 238];
    stroke(ink, [p0, [p0[0] * 0.5 + p1[0] * 0.5 - Math.sin(an) * 12, p0[1] * 0.5 + p1[1] * 0.5 + Math.cos(an) * 12], p1], 3.0, { taper: 30 });
    const ae = ellipse(p1[0], p1[1], 58, 30, an, 24);
    ink.group('ol'); outline(ink, ae.polys[0], { w: 2.6, light: LV, vary: 0.85, seed: seed + 30 + k });
    ink.group('h2'); hatch(ink, ae.polys, { angle: an + 0.5, spacing: 7, tone: () => 0.72, thr: 0.35, wMax: 2.2, wMin: 0.8, seed: seed + 40 + k, taper: 4, step: 2 });
  }
  // the style and its two-lobed stigma, with the pollen that has fallen on it
  const sa2 = -0.95, s1 = [Math.cos(sa2) * 318, Math.sin(sa2) * 318];
  ink.group('ol');
  stroke(ink, [[0, 0], [Math.cos(sa2) * 150 - 24, Math.sin(sa2) * 150 + 8], s1], 3.2, { taper: 40 });
  for (const sg of [1, -1]) stroke(ink, [s1, [s1[0] + sg * 44 - 14, s1[1] - 58], [s1[0] + sg * 78 - 24, s1[1] - 74]], 2.4, { taper: 10 });
  const Rg = RNG(seed + 77);
  ink.group('h3');
  for (let k = 0; k < 26; k++) {
    const a = Rg() * TAU, rr = 20 + Rg() * 96;
    const px = s1[0] + Math.cos(a) * rr - 14, py = s1[1] + Math.sin(a) * rr * 0.6 - 46;
    const r2 = 3.2 + Rg() * 3.4;
    outline(ink, ellipsePts(px, py, r2, r2 * 0.88, Rg() * 3, 10), { w: 1.6, light: LV, vary: 1, run: 0 });
  }
  ruled(ink, [...allP, ...thr0.polys, ...halo(allP, 24)]);
  return { ink, regions: { flower: { path: (() => { const p = new Path2D(); for (const lb of lobes) p.addPath(lb.path); return p; })(), polys: allP } }, specimen: allP };
}

// ---------------------------------------------------------------------------- Fig. 2 · the fruit
// A cherry, twice: on the left the whole fruit; on the right the same fruit halved lengthwise, so
// the five coats read in order — exocarp, mesocarp (the flesh), the parchment endocarp, the silver
// skin — with the two seeds lying flat face to flat face in the middle.
function buildCherry({ seed = 5 } = {}) {
  const ink = new B.Ink(), HW = 130, HL = 290, XL = -166, XR = 166;
  const fr = (cx, hw, hl, rot = 0, n = 72) => ring(ellipsePts(cx, 0, hw, hl, rot, n));
  // ---- left: the whole fruit ----
  const whole = fr(XL, HW, HL, -0.05);
  const wT = sphereTone(XL - HW * 0.25, -HL * 0.30, HW * 1.15, HL * 0.95, { L, base: 0.03 });
  ink.group('ol'); outline(ink, whole.polys[0], { w: 4.6, light: LV, vary: 0.9, seed, run: 190, pinch: 0.5 });
  ink.group('h1'); hatch(ink, whole.polys, { angle: 1.42, spacing: 10, bend: 0.00042, tone: wT, thr: 0.26, wMax: 3.2, wMin: 0.8, seed: seed + 1, taper: 26, step: 3 });
  ink.group('h2'); hatch(ink, whole.polys, { angle: 0.45, spacing: 11, bend: -0.0003, tone: wT, thr: 0.62, wMax: 2.4, wMin: 0.8, seed: seed + 2, taper: 18, step: 3 });
  ink.group('h3'); hatch(ink, whole.polys, { angle: 1.25, spacing: 12, bend: 0.0003, tone: wT, thr: 0.86, wMax: 1.9, wMin: 0.8, seed: seed + 3, taper: 14, step: 3 });
  // the disc of the calyx the flower left at the apex, and the pedicel stub below
  ink.group('ol');
  const cap = ellipse(XL - 6, -HL + 8, 34, 15, -0.05, 26);
  outline(ink, cap.polys[0], { w: 2.4, light: LV, vary: 0.9, seed: seed + 4 });
  for (let k = 0; k < 5; k++) { const an = -Math.PI / 2 + (k - 2) * 0.44; stroke(ink, [[XL - 6, -HL + 10], [XL - 6 + Math.cos(an) * 52, -HL + 10 + Math.sin(an) * 30]], 1.8, { taper: 6 }); }
  stroke(ink, [[XL, HL - 4], [XL, HL + 46]], 5.0, { taper: 22 });
  // ---- right: the fruit halved ----
  const S = fr(XR, HW, HL, 0);
  const k1 = 0.905, k2 = 0.775, k3 = 0.725, k4 = 0.685, k5 = 0.655;
  const L1 = fr(XR, HW * k1, HL * k1), L2 = fr(XR, HW * k2, HL * k2), L3 = fr(XR, HW * k3, HL * k3), L4 = fr(XR, HW * k4, HL * k4), L5 = fr(XR, HW * k5, HL * k5);
  const seedHalf = sg => { const pts = []; for (let i = 0; i <= 60; i++) { const a = -Math.PI / 2 + Math.PI * i / 60; pts.push([XR + Math.cos(a) * HW * k5 * sg, Math.sin(a) * HL * k5]); } return ring(pts); };
  const sA = seedHalf(-1), sB = seedHalf(1);
  const bands = [[S, L1, 0.93, 3.2, 0.80], [L1, L2, 0.26, 2.6, 0.55], [L2, L3, 0.58, 2.4, 0.70], [L3, L4, 0.66, 2.2, 0.78]];
  const toneOf = v => () => v;
  ink.group('h1'); hatch(ink, S.polys, { angle: 1.55, spacing: 4.5, tone: toneOf(bands[0][2]), thr: 0, wMax: 3.0, wMin: 1.5, seed: seed + 10, taper: 4, step: 2, excl: L1.polys });
  ink.group('h1'); hatch(ink, L1.polys, { angle: 0.95, spacing: 9, tone: toneOf(bands[1][2]), thr: 0.05, wMax: 2.8, wMin: 0.8, seed: seed + 11, taper: 16, step: 3, excl: L2.polys });
  ink.group('h2'); hatch(ink, L2.polys, { angle: -0.65, spacing: 7, tone: toneOf(bands[2][2]), thr: 0.10, wMax: 2.4, wMin: 0.8, seed: seed + 12, taper: 10, step: 3, excl: L3.polys });
  ink.group('h3'); hatch(ink, L3.polys, { angle: 0.35, spacing: 5, tone: toneOf(bands[3][2]), thr: 0.10, wMax: 2.2, wMin: 0.8, seed: seed + 13, taper: 6, step: 2, excl: L4.polys });
  ink.group('ol'); outline(ink, S.polys[0], { w: 4.6, light: LV, vary: 0.9, seed: seed + 14, run: 190, pinch: 0.5 });
  for (const l of [L1, L2, L3, L4, L5]) { ink.group('ol'); outline(ink, l.polys[0], { w: 2.2, light: LV, vary: 0.7, seed: seed + 15, run: 80, pinch: 0.6 }); }
  // the two seeds, plano-convex, flat faces together along the fruit's axis
  const st = sphereTone(XR, 0, HW * k5 * 0.98, HL * k5 * 0.98, { L, base: 0.02 });
  for (const [sd, sg] of [[sA, -1], [sB, 1]]) {
    ink.group('ol'); outline(ink, sd.polys[0], { w: 3.0, light: LV, vary: 0.35, seed: seed + 20 + (sg > 0 ? 1 : 0), run: 70 });
    ink.group('h1'); hatch(ink, sd.polys, { angle: 0.55, spacing: 6, tone: st, thr: 0.10, wMax: 2.6, wMin: 0.8, seed: seed + 22 + (sg > 0 ? 1 : 0), taper: 12, step: 3 });
    ink.group('h2'); hatch(ink, sd.polys, { angle: -0.8, spacing: 7, tone: st, thr: 0.42, wMax: 2.0, wMin: 0.8, seed: seed + 24 + (sg > 0 ? 1 : 0), taper: 8, step: 3 });
  }
  // the seam where the two flat faces meet
  ink.group('ol');
  stroke(ink, [[XR, -HL * k5], [XR, HL * k5]], 2.6, { taper: 16 });
  const body = new Path2D(); body.addPath(whole.path); body.addPath(S.path); body.addPath((() => { const p = new Path2D(); p.addPath(L2.path); return p; })());
  ruled(ink, [...whole.polys, ...S.polys, ...halo([...whole.polys, ...S.polys], 40)]);
  return { ink, regions: { cherry: { path: body, polys: [...whole.polys, ...S.polys, ...L2.polys] }, bean: { path: (() => { const p = new Path2D(); p.addPath(sA.path); p.addPath(sB.path); return p; })(), polys: [...sA.polys, ...sB.polys] } }, specimen: [...whole.polys, ...S.polys] };
}

// ---------------------------------------------------------------------------- Fig. 3 · the seeds
// Two seeds taken out of the fruit and laid flat face up, the wavy centre-cut running their length,
// and beside them a peaberry — the single round seed a fruit sometimes ripens instead of two.
function buildSeed({ seed = 7 } = {}) {
  const ink = new B.Ink();
  const spec = [];
  // a seed seen from its flat face: an ellipse with the centre-cut meandering down it
  function seedAt(cx, cy, rot, hl, hw, sd) {
    const pts = [];
    for (let i = 0; i < 64; i++) {
      const a = TAU * i / 64, ex = Math.cos(a) * hl, ey = Math.sin(a) * hw * (1 + 0.05 * Math.cos(a));
      pts.push([cx + ex * Math.cos(rot) - ey * Math.sin(rot), cy + ex * Math.sin(rot) + ey * Math.cos(rot)]);
    }
    const sh = ring(pts);
    const tt = sphereTone(cx, cy, hl * 1.05, hw * 1.2, { L, rot, base: 0.04 });
    ink.group('ol'); outline(ink, sh.polys[0], { w: 4.2, light: LV, vary: 0.9, seed: sd, run: 170, pinch: 0.5 });
    ink.group('h1'); hatch(ink, sh.polys, { angle: rot + 1.5, spacing: 9, bend: -0.0007, tone: tt, thr: 0.18, wMax: 3.0, wMin: 0.8, seed: sd + 1, taper: 22, step: 3 });
    ink.group('h2'); hatch(ink, sh.polys, { angle: rot + 0.35, spacing: 10, tone: tt, thr: 0.56, wMax: 2.2, wMin: 0.8, seed: sd + 2, taper: 14, step: 3 });
    ink.group('h3'); hatch(ink, sh.polys, { angle: rot - 0.8, spacing: 11, tone: tt, thr: 0.80, wMax: 1.8, wMin: 0.8, seed: sd + 3, taper: 10, step: 3 });
    // the centre-cut: a groove that wanders the length of the flat face
    const cr = Math.cos(rot), sr = Math.sin(rot), g = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, u = -hl * 0.93 + hl * 1.86 * t;
      const off = hw * 0.14 * Math.sin(t * 6.1 + 0.7) + hw * 0.07 * Math.sin(t * 13.7);
      g.push([cx + u * cr - off * sr, cy + u * sr + off * cr]);
    }
    ink.group('ol');
    ink.add(g, g.map((_, i) => { const t = i / 40; return (0.6 + 2.6 * Math.sin(Math.PI * (0.05 + 0.9 * t))) * (1 - 0.35 * Math.pow(Math.abs(2 * t - 1), 3)); }));
    // the hilum, a small scar at the blunt end
    const hx = cx - hl * 0.86 * cr, hy = cy - hl * 0.86 * sr;
    ink.group('ol'); stroke(ink, [[hx - sr * hw * 0.16, hy + cr * hw * 0.16], [hx + sr * hw * 0.16, hy - cr * hw * 0.16]], 2.6, { taper: 4 });
    spec.push(...sh.polys);
    return sh;
  }
  const sA = seedAt(-222, -138, -0.52, 192, 119, seed);
  const sB = seedAt(204, 40, 0.31, 186, 115, seed + 40);
  // the peaberry: one seed that grew alone, so it is a round ball with only a faint groove
  const px = -34, py = 292, pr = 162;
  const pea = ellipse(px, py, pr, pr * 0.98, 0, 72);
  const pt = sphereTone(px, py, pr, pr * 0.98, { L, base: 0.03 });
  ink.group('ol'); outline(ink, pea.polys[0], { w: 4.4, light: LV, vary: 0.9, seed: seed + 80, run: 180, pinch: 0.5 });
  ink.group('h1'); hatch(ink, pea.polys, { angle: 1.30, spacing: 9, bend: 0.0006, tone: pt, thr: 0.16, wMax: 3.2, wMin: 0.8, seed: seed + 81, taper: 24, step: 3 });
  ink.group('h2'); hatch(ink, pea.polys, { angle: 0.35, spacing: 10, bend: -0.0005, tone: pt, thr: 0.55, wMax: 2.4, wMin: 0.8, seed: seed + 82, taper: 16, step: 3 });
  ink.group('h3'); hatch(ink, pea.polys, { angle: 1.15, spacing: 11, bend: 0.0005, tone: pt, thr: 0.82, wMax: 1.8, wMin: 0.8, seed: seed + 83, taper: 12, step: 3 });
  ink.group('ol');
  const gg = [];
  for (let i = 0; i <= 26; i++) { const t = i / 26; gg.push([px - pr * 0.72 + pr * 1.44 * t, py + pr * 0.20 * Math.sin(t * 5.2 + 1.1)]); }
  ink.add(gg, gg.map((_, i) => 0.6 + 2.2 * Math.sin(Math.PI * (0.06 + 0.88 * i / 26))));
  spec.push(...pea.polys);
  ruled(ink, [...spec, ...halo(spec, 26)]);
  return { ink, regions: { bean: { path: (() => { const p = new Path2D(); p.addPath(sA.path); p.addPath(sB.path); p.addPath(pea.path); return p; })(), polys: spec } }, specimen: spec };
}

// ---------------------------------------------------------------------------- Fig. 4 · the harbour
// An inset on the chart: the roadstead of Mocha in the seventeenth century — the shore, the quay
// with its stone edge, bales waiting on it, a hut, palms, and three dhows under lateen sail.
// Pure line: a chart inset is never coloured.
function buildHarbour({ seed = 11 } = {}) {
  const ink = new B.Ink(), regions = {};
  const shore = x => 34 + 66 * Math.sin(x / 470 * Math.PI * 0.9) + 22 * Math.sin(x / 150 + 0.4) - 0.00016 * x * x;
  const xs = []; for (let x = -520; x <= 520; x += 8) xs.push(x);
  const coast = xs.map(x => [x, shore(x)]);
  // the sea, ruled; the land left bare
  const seaP = ring([...coast, [520, 560], [-520, 560]]);
  ink.group('rule');
  hatch(ink, seaP.polys, { angle: 0, spacing: 13, tone: (x, y) => clamp(0.20 + 0.5 * sstep(60, 300, y - shore(clamp(x, -520, 520))) + 0.06 * noise2(x / 90, y / 90, seed)), thr: 0.16, wMax: 2.4, wMin: 0.8, seed: seed + 1, taper: 30, step: 3 });
  ink.group('h3');
  stipple(ink, seaP.polys, { density: 0.00055, tone: () => 0.55, r: 2.0, seed: seed + 2, thr: 0.1 });
  // the shoreline itself, and the bank behind it
  ink.group('ol');
  stroke(ink, coast, 3.4, { taper: 90 });
  ink.group('h2');
  hatch(ink, ring([...coast, [520, -300], [-520, -300]]).polys, { angle: 0.85, spacing: 10, tone: (x, y) => clamp(0.12 + 0.5 * sstep(0, -90, y - shore(clamp(x, -520, 520)))), thr: 0.18, wMax: 2.4, wMin: 0.8, seed: seed + 3, taper: 20, step: 3 });
  // the quay: a stone edge running out from the shore, with its wall below
  const qy = x => shore(x) + 16;
  const q0 = -286, q1 = 214;
  const quayTop = []; for (let x = q0; x <= q1; x += 10) quayTop.push([x, qy(x)]);
  ink.group('ol'); stroke(ink, quayTop, 3.2, { taper: 40 });
  const wall = ring([...quayTop, [q1, qy(q1) + 52], [q0, qy(q0) + 52]]);
  ink.group('h1'); hatch(ink, wall.polys, { angle: 1.55, spacing: 11, tone: () => 0.45, thr: 0.1, wMax: 2.2, wMin: 0.8, seed: seed + 4, taper: 6, step: 2 });
  ink.group('h2'); hatch(ink, wall.polys, { angle: 0.1, spacing: 9, tone: () => 0.62, thr: 0.3, wMax: 2.0, wMin: 0.8, seed: seed + 5, taper: 4, step: 2 });
  ink.group('ol');
  for (let x = q0 + 24; x < q1; x += 46) stroke(ink, [[x, qy(x) + 2], [x + 2, qy(x) + 50]], 1.5, { taper: 6 });
  // bales waiting on the quay
  ink.group('ol');
  const bales = [[-186, -6, 76, 44, -0.06], [-104, -22, 70, 40, 0.05], [-150, -56, 74, 42, -0.02], [64, -18, 82, 48, 0.04], [150, -30, 70, 42, -0.05]];
  for (const [bx, by, bw, bh, br] of bales) {
    const c = Math.cos(br), sn = Math.sin(br), r = Math.min(bw, bh) * 0.20;
    const loc = [[-bw / 2 + r, -bh / 2], [bw / 2 - r, -bh / 2], [bw / 2, -bh / 2 + r], [bw / 2, bh / 2 - r], [bw / 2 - r, bh / 2], [-bw / 2 + r, bh / 2], [-bw / 2, bh / 2 - r], [-bw / 2, -bh / 2 + r]];
    const sh = ring(loc.map(([x, y]) => [bx + x * c - y * sn, by + x * sn + y * c]));
    ink.group('ol'); outline(ink, sh.polys[0], { w: 2.6, light: LV, vary: 0.6, seed: seed + 20 + bx, run: 50 });
    ink.group('h2'); hatch(ink, sh.polys, { angle: 1.5, spacing: 7, tone: () => 0.55, thr: 0.22, wMax: 2.0, wMin: 0.8, seed: seed + 30 + bx, taper: 5, step: 2 });
    // the two cords round it
    ink.group('ol');
    for (const o of [-0.22, 0.22]) stroke(ink, [[bx + o * bw * c - (-bh / 2) * sn, by + o * bw * sn + (-bh / 2) * c], [bx + o * bw * c - (bh / 2) * sn, by + o * bw * sn + (bh / 2) * c]], 1.5, { taper: 4 });
  }
  // a hut with a pitched roof and a door
  const hx = -352, hy = -186, hw = 96, hh = 74;
  ink.group('ol');
  outline(ink, ring([[hx - hw, hy + hh], [hx + hw, hy + hh], [hx + hw, hy], [hx - hw, hy]]).polys[0], { w: 3.0, light: LV, vary: 0.85, seed: seed + 40, run: 90 });
  stroke(ink, [[hx - hw - 26, hy], [hx, hy - 78], [hx + hw + 26, hy]], 3.2, { taper: 26 });
  const body = ring([[hx - hw, hy + hh], [hx + hw, hy + hh], [hx + hw, hy], [hx - hw, hy]]);
  ink.group('h1'); hatch(ink, body.polys, { angle: 1.5, spacing: 9, tone: (x, y) => clamp(0.2 + 0.55 * sstep(hx - hw, hx + hw, x)), thr: 0.15, wMax: 2.2, wMin: 0.8, seed: seed + 41, taper: 8, step: 2 });
  ink.group('h2'); hatch(ink, body.polys, { angle: 0.3, spacing: 10, tone: () => 0.55, thr: 0.42, wMax: 1.9, wMin: 0.8, seed: seed + 42, taper: 6, step: 2 });
  ink.group('ol'); outline(ink, ring([[hx - 16, hy + hh], [hx + 16, hy + hh], [hx + 16, hy + 44], [hx - 16, hy + 44]]).polys[0], { w: 2.2, light: LV, vary: 0.8, seed: seed + 43 });
  // palms
  for (const [px, py, k] of [[272, -232, 1.0], [366, -152, 0.78]]) {
    ink.group('ol');
    const top = [px + 26 * k, py - 128 * k];
    stroke(ink, [[px, py], [px + 12 * k, py - 66 * k], top], 3.0 * k, { taper: 26 });
    for (let f = 0; f < 7; f++) {
      const a = -Math.PI / 2 + (f - 3) * 0.52, L2 = (86 + 22 * Math.sin(f * 1.7)) * k;
      stroke(ink, [top, [top[0] + Math.cos(a) * L2 * 0.6, top[1] + Math.sin(a) * L2 * 0.75], [top[0] + Math.cos(a) * L2, top[1] + Math.sin(a) * L2 + L2 * 0.42]], 2.4 * k, { taper: 18 });
    }
  }
  // three dhows under lateen sail
  function dhow(cx, cy, k, flip) {
    const sg = flip ? -1 : 1, T = ([x, y]) => [cx + x * k * sg, cy + y * k];
    ink.group('ol');
    // hull
    const hull = B.parseD(`M-96 0 C-84 22 -52 34 -6 34 C44 34 78 24 98 4 C74 12 20 18 -24 16 C-56 15 -80 10 -96 0 Z`, 3)[0].pts.map(T);
    outline(ink, hull, { w: 2.8 * k, light: LV, vary: 0.85, seed: seed + 50, run: 70 });
    const hsh = ring(hull);
    ink.group('h2'); hatch(ink, hsh.polys, { angle: 0.2, spacing: 6 * k, tone: () => 0.62, thr: 0.3, wMax: 1.9 * k, wMin: 0.8, seed: seed + 51, taper: 4, step: 2 });
    // the deck line and the rudder
    stroke(ink, [T([-98, 4]), T([102, 6])], 1.5 * k, { taper: 5 });
    stroke(ink, [T([96, 10]), T([114, 42])], 1.6 * k, { taper: 5 });
    // mast, and the long yard slung across it with its fore end cocked high
    stroke(ink, [T([-10, 34]), T([-16, -170])], 2.6 * k, { taper: 22 });
    stroke(ink, [T([-160, -30]), T([28, -188])], 2.2 * k, { taper: 18 });
    // the sail: a triangle hanging from the yard, its tack lashed down to the deck
    const sail = [T([-152, -36]), T([20, -182]), T([-54, 24])];
    outline(ink, sail, { w: 2.6 * k, light: LV, vary: 0.85, seed: seed + 52, run: 60 });
    const ssh = ring(sail);
    ink.group('h1'); hatch(ink, ssh.polys, { angle: 1.30, spacing: 8 * k, tone: (x, y) => clamp(0.12 + 0.64 * clamp((x - cx) * sg / (150 * k) + 0.5)), thr: 0.14, wMax: 2.4 * k, wMin: 0.8, seed: seed + 53, taper: 10, step: 2 });
    ink.group('h3'); hatch(ink, ssh.polys, { angle: 0.5, spacing: 10 * k, tone: () => 0.86, thr: 0.74, wMax: 1.8 * k, wMin: 0.8, seed: seed + 54, taper: 6, step: 2 });
    // the little flag at the masthead
    ink.group('ol'); stroke(ink, [T([-16, -170]), T([18, -162]), T([-16, -148])], 1.6 * k, { taper: 4 });
  }
  dhow(-330, 236, 0.86, false);
  dhow(-30, 296, 1.0, true);
  dhow(238, 218, 0.78, false);
  // a compass rose on the land
  const rx = 128, ry = -352, rr = 58;
  ink.group('ol');
  outline(ink, ellipsePts(rx, ry, rr, rr, 0, 48), { w: 2.0, light: LV, vary: 0.7, seed: seed + 60, run: 40 });
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8, w2 = k % 2 ? rr * 0.42 : rr * 0.78;
    stroke(ink, [[rx, ry], [rx + Math.cos(a) * w2, ry + Math.sin(a) * w2]], k % 2 ? 1.4 : 2.2, { taper: 5 });
  }
  ink.group('h3'); ink.dot(rx, ry, 3.0);
  return { ink, regions, specimen: [], noRule: true };
}
