// Coffea arabica — a fruiting branch, drawn the way a 19th-century botanical plate draws one:
// a woody branch cut at the base, four pairs of opposite elliptic leaves with acuminate tips and
// arcuate lateral veins, clusters of white five-lobed flowers in the upper axils, clusters of red
// cherries on very short pedicels on the bare lower wood, and one fruit in longitudinal section
// standing at the apex.
//
// buildCoffee({ x, y, s, seed }) → { ink, regions, focus }
//   ink groups, in cutting order: 'ol0' (the branch margin — the one long line the burin cuts first),
//   'ol' (outlines, midribs, veins, stamens), 'h1', 'h2', 'h3' (three hatching families).
//   regions: leaf, flower, cherry, stem, bean      (the hand-colourist's areas)
//   focus: flower, cherry, seed, leaf, harbour (+ eye, the fallback film.js:58 relies on)
//
// The plate is cut in two passes. Everything is measured first, so that whatever stands in front
// (a flower, a cherry) can be handed to the hatching behind it as `excl`: the burin stops at the
// near edge and the near thing keeps the paper bare.
import * as B from '../engine/burin.js';
const { ring, clamp, sstep, sphereTone, hatch, outline, stroke, RNG, noise2, ellipsePts, ellipse, normals, inAny, bboxOf } = B;

const L = { x: -0.55, y: -0.62, z: 0.56 }, LV = [L.x, L.y];
const TAU = Math.PI * 2, D2R = Math.PI / 180;

// a closed tapering tube between two points, with round caps (petioles, pedicels)
function tube2(a, b, w0, w1, n = 8) {
  const dx = b[0] - a[0], dy = b[1] - a[1], ln = Math.hypot(dx, dy) || 1, ux = dx / ln, uy = dy / ln, nx = -uy, ny = ux, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, w = (w0 + (w1 - w0) * t) * 0.5, px = a[0] + dx * t, py = a[1] + dy * t; pts.push([px + nx * w, py + ny * w]); }
  for (let k = 1; k < 8; k++) { const an = Math.PI * (0.5 + k / 8); pts.push([b[0] + (ux * Math.cos(an) + nx * Math.sin(an)) * w1 * 0.5, b[1] + (uy * Math.cos(an) + ny * Math.sin(an)) * w1 * 0.5]); }
  for (let i = n; i >= 0; i--) { const t = i / n, w = (w0 + (w1 - w0) * t) * 0.5, px = a[0] + dx * t, py = a[1] + dy * t; pts.push([px - nx * w, py - ny * w]); }
  for (let k = 1; k < 8; k++) { const an = Math.PI * (1.5 + k / 8); pts.push([a[0] + (ux * Math.cos(an) + nx * Math.sin(an)) * w0 * 0.5, a[1] + (uy * Math.cos(an) + ny * Math.sin(an)) * w0 * 0.5]); }
  return ring(pts);
}

// a closed polygon Path2D from a world point list (reversed → the ring cuts a hole)
function pathOf(pts, rev = false) {
  const p = new Path2D(), q = rev ? pts.slice().reverse() : pts;
  q.forEach(([px, py], i) => { i ? p.lineTo(px, py) : p.moveTo(px, py); });
  p.closePath(); return p;
}

// half-width profile of a coffee leaf blade, v = 0 at the base … 1 at the acuminate tip
const hwShape = v => Math.pow(clamp((v - 0.02) / 0.30), 0.55) * Math.pow(1 - sstep(0.72, 1.0, v), 1.1);

// the five spreading corolla lobes of one flower, as closed rings about (cx, cy).
// Narrow and oblong: a coffee corolla is a star of five thin petals, not a rosette.
// `sd` only jitters the five against one another — no flower is drawn with five equal petals.
function flowerLobes(cx, cy, phi, R, sd = 1) {
  const out = [], Rh = RNG(sd);
  const var_ = Array.from({ length: 5 }, () => ({ l: 0.92 + 0.17 * Rh(), w: 0.86 + 0.28 * Rh(), a: (Rh() - 0.5) * 0.16 }));
  for (let k = 0; k < 5; k++) {
    const vv = var_[k];
    const ang = phi + k * TAU / 5 + vv.a, ca = Math.cos(ang), sa = Math.sin(ang), pa = -sa, pb = ca;
    const up = [], dn = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26, r = R * vv.l * (0.13 + 0.87 * t);
      // an oblong petal with an obtuse tip: t^0.35 (1−t)^0.45 peaks at t = 0.44 and is still
      // nearly three-quarters of its width at t = 0.98 — a petal, not a leaf
      const h = 0.30 * R * vv.w * (Math.pow(Math.max(1e-3, t), 0.35) * Math.pow(1 - t + 1e-3, 0.45)) / 0.5779;
      const bx = cx + ca * r, by = cy + sa * r;
      up.push([bx + pa * h, by + pb * h]); dn.push([bx - pa * h, by - pb * h]);
    }
    out.push(Object.assign(ring([...up, ...dn.reverse()]), { ang }));
  }
  return out;
}

export function buildCoffee({ x = 960, y = 560, s = 1, seed = 12 } = {}) {
  const ink = new B.Ink();
  const P = ([u, v]) => [x + u * s, y + v * s];
  const SC = v => v * s;
  const regions = {}, reg = (k, sh) => { (regions[k] ||= []).push(sh); };

  // ═══════════════════════════════ 1. measure ═══════════════════════════════

  // ---- the branch ----
  const Y0 = 200, Y1 = -205;                                   // base … tip (local y); y is down
  const spineY = u => Y0 + (Y1 - Y0) * u;
  const hwB = u => (25 - 15 * u) * (1 + 0.55 * Math.exp(-((u / 0.055) ** 2))) * (1 + 0.05 * Math.sin(u * 8.5));
  const NB = 140, brL = [];
  for (let i = 0; i <= NB; i++) { const u = i / NB; brL.push([hwB(u), spineY(u)]); }
  for (let i = NB; i >= 0; i--) { const u = i / NB; brL.push([-hwB(u), spineY(u)]); }
  const branch = ring(brL.map(P));
  // a lit cylinder standing on the plate: the burin lifts along the left edge and bites on the right
  const brTone = (px, py) => {
    const lv = (py - y) / s, u = clamp((Y0 - lv) / (Y0 - Y1), 0, 1);
    const q = clamp(((px - x) / s) / (hwB(u) * 1.08), -1, 1), nz = Math.sqrt(Math.max(0, 1 - q * q));
    return clamp(0.05 + (1 - clamp(q * L.x + nz * L.z)) * 0.92);
  };

  // ---- the leaves ----
  const LEAVES = [
    { u: 0.30, b: -6, len: 540, pet: 46, wid: 0.300, curl: 0.44 },
    { u: 0.48, b: 8, len: 630, pet: 47, wid: 0.296, curl: 0.34 },
    { u: 0.66, b: 32, len: 500, pet: 40, wid: 0.292, curl: 0.24 },
    { u: 0.84, b: 48, len: 330, pet: 30, wid: 0.288, curl: 0.14 },
  ];
  const LG = [];                                        // one record per blade
  LEAVES.forEach((spec, li) => {
    const ny = spineY(spec.u);
    for (const side of [-1, 1]) {
      const th = side > 0 ? -spec.b * D2R : Math.PI + spec.b * D2R;
      const cs = Math.cos(th), sn = Math.sin(th);
      const O = [cs * spec.pet, ny + sn * spec.pet];
      const curlA = (side > 0 ? spec.curl : -spec.curl) * 0.10 * spec.len;
      const mAt = v => [v * spec.len, curlA * v * v];
      const nAt = v => { const tx = spec.len, ty = 2 * curlA * v, l = Math.hypot(tx, ty); return [-ty / l, tx / l]; };
      const toW = ([lx, ly]) => P([O[0] + lx * cs - ly * sn, O[1] + lx * sn + ly * cs]);
      const half = v => hwShape(v) * spec.wid * spec.len * 0.5 * (1 + 0.020 * Math.sin(v * spec.len * 0.42));
      const bl = [], NS = 46;
      for (let i = 0; i <= NS; i++) { const v = i / NS, m = mAt(v), n = nAt(v), h = half(v); bl.push(toW([m[0] + n[0] * h, m[1] + n[1] * h])); }
      for (let i = NS; i >= 0; i--) { const v = i / NS, m = mAt(v), n = nAt(v), h = half(v); bl.push(toW([m[0] - n[0] * h, m[1] - n[1] * h])); }
      const blade = ring(bl);
      const ribW = []; for (let i = 0; i <= 40; i++) { const v = 0.02 + 0.96 * i / 40; ribW.push(toW(mAt(v))); }
      const nrm = normals(ribW, false), bandL = [];
      for (let i = 0; i < ribW.length; i++) { const v = i / 40, ww = SC(1.3 + 2.6 * Math.pow(1 - v, 0.8)); bandL.push([ribW[i][0] + nrm[i][0] * ww, ribW[i][1] + nrm[i][1] * ww]); }
      for (let i = ribW.length - 1; i >= 0; i--) { const v = i / 40, ww = SC(1.3 + 2.6 * Math.pow(1 - v, 0.8)); bandL.push([ribW[i][0] - nrm[i][0] * ww, ribW[i][1] - nrm[i][1] * ww]); }
      const bc = toW([0.48 * spec.len, curlA * 0.23]);
      const sph = sphereTone(bc[0], bc[1], SC(spec.len * 0.52), SC(spec.wid * spec.len * 0.62), { L, rot: th, base: 0.04 });
      const lTone = (px, py) => {
        const dx = (px - x) / s - O[0], dy = (py - y) / s - O[1];
        const v = clamp((dx * cs + dy * sn) / spec.len, 0, 1);
        const wq = clamp((-dx * sn + dy * cs) / Math.max(1e-4, half(v)), -2, 2);
        return clamp(sph(px, py) - 0.32 * Math.exp(-((wq / 0.42) ** 2)) + 0.05 * (noise2(px / 26, py / 26, li + 3) - 0.5));
      };
      // lateral veins: they leave the midrib at a wide angle and sweep forward toward the apex
      const VEINS = [];
      for (let k = 0; k < 12; k++) {
        const v0 = 0.085 + k * 0.068;
        for (const sg of [1, -1]) {
          const pts = [], ws = [];
          for (let i = 0; i <= 16; i++) {
            const t = i / 16, v = v0 + 0.24 * Math.pow(t, 1.30), lat = Math.pow(t, 0.42);
            const m = mAt(v), n = nAt(v), h = half(v);
            pts.push(toW([m[0] + n[0] * h * lat * sg, m[1] + n[1] * h * lat * sg]));
            ws.push(0.28 + 1.6 * Math.pow(1 - t, 1.2));
          }
          VEINS.push([pts, ws]);
        }
      }
      const pet = tube2(P([0, ny]), P(O), SC(7.6), SC(5.6));
      LG.push({ spec, li, side, th, blade, ribW, midBand: ring(bandL), lTone, VEINS, pet, bc });
      reg('leaf', blade); reg('stem', pet);
    }
  });

  // ---- the cherries ----
  const FRU = [];
  {
    const Rf = RNG(seed + 300), jit = [];
    for (let k = 0; k < 4; k++) jit.push({ j: Rf() - 0.5, jl: Rf() - 0.5, jw: Rf() - 0.5, jp: Rf() - 0.5 });
    const ANG = [10, 45, 78, 105], PED = [34, 48, 58, 62], FU = 0.170;
    for (const sgn of [1, -1]) {
      const ox = (hwB(FU) + 3) * sgn, oy = spineY(FU);
      jit.forEach((q, k) => {
        const a = sgn > 0 ? (ANG[k] + 5 * q.j) * D2R : Math.PI - (ANG[k] + 5 * q.j) * D2R;
        const pl = PED[k] + 8 * q.jp;
        const bx = ox + Math.cos(a) * pl, by = oy + Math.sin(a) * pl;
        const hl = 28 + 3 * q.jl, hw = 23 + 2.5 * q.jw;
        const fw = P([bx + Math.cos(a) * hl, by + Math.sin(a) * hl]);
        FRU.push({
          a, fw, H: SC(hl), Wd: SC(hw),
          sh: ring(ellipsePts(fw[0], fw[1], SC(hl), SC(hw), a, 40)),
          ped: tube2(P([ox, oy]), P([bx, by]), SC(4.8), SC(3.8)),
          sd: seed + 320 + k + (sgn > 0 ? 0 : 40),
        });
      });
    }
  }

  // ---- the flowers ----
  const FLW = [], FL_U = 0.395, FL_OY = spineY(FL_U);
  {
    const Rf = RNG(seed + 400), jit = [];
    for (let k = 0; k < 3; k++) jit.push({ j: Rf() - 0.5, jr: Rf() - 0.5, jp: Rf() - 0.5 });
    const FANG = [-62, -22, 16], FPED = [34, 66, 56];
    for (const sgn of [1, -1]) {
      const ox = (hwB(FL_U) + 2) * sgn, oy = FL_OY;
      jit.forEach((q, k) => {
        const a0 = (FANG[k] + 4 * q.j) * D2R;
        const a = sgn > 0 ? a0 : Math.PI - a0;
        const pl = FPED[k] + 9 * q.jp + 8;
        const bx = ox + Math.cos(a) * pl, by = oy + Math.sin(a) * pl;
        const R = (57 + 5 * q.jr) * s;
        const cc = P([bx + Math.cos(a) * R * 0.94, by + Math.sin(a) * R * 0.94]);   // world
        const lobes = flowerLobes(cc[0], cc[1], a, R, seed + 410 + k + (sgn > 0 ? 0 : 60));
        const thr = ellipse(cc[0], cc[1], R * 0.17, R * 0.17, 0, 14);
        const stam = [];
        for (let j = 0; j < 5; j++) {
          const an = a + (j + 0.5) * TAU / 5;
          const p0 = [cc[0] + Math.cos(an) * R * 0.10, cc[1] + Math.sin(an) * R * 0.10];
          const p1 = [cc[0] + Math.cos(an) * R * 0.56, cc[1] + Math.sin(an) * R * 0.56];
          stam.push({ an, p1, fil: [p0, p1], ant: ellipse(p1[0], p1[1], R * 0.150, R * 0.050, an, 16) });
        }
        const sa = a - Math.PI / 2 + 0.25;
        const s1 = [cc[0] + Math.cos(sa) * R * 0.72, cc[1] + Math.sin(sa) * R * 0.72];
        FLW.push({ a, R, cc, lobes, thr, stam, s1, sa, ped: tube2(P([ox, oy]), P([bx, by]), SC(4.8), SC(3.8)), sd: seed + 420 + k + (sgn > 0 ? 0 : 60) });
      });
      // one bud beside the open flowers: the cluster is never all out at once
      const bA = sgn > 0 ? -78 * D2R : Math.PI + 78 * D2R;
      const bx = ox + Math.cos(bA) * 26, by = oy + Math.sin(bA) * 26;
      const bW = P([bx + Math.cos(bA) * 15, by + Math.sin(bA) * 15]);
      const budR = ring(ellipsePts(bW[0], bW[1], SC(17), SC(12), bA, 30));
      FLW.push({ bud: true, budR, bt: sphereTone(bW[0], bW[1], SC(17), SC(12), { L, rot: bA, base: 0.02 }), bA, ped: tube2(P([ox, oy]), P([bx, by]), SC(4.2), SC(3.4)), sd: seed + 470 + (sgn > 0 ? 0 : 60) });
    }
  }

  // ---- one fruit in longitudinal section, standing at the apex ----
  const SFY = -278, SRX = 58, SRY = 76;
  const sfO = ring(ellipsePts(0, SFY, SRX, SRY, 0, 84).map(P));
  const lay = (k, n = 84) => ring(ellipsePts(0, SFY, SRX * k, SRY * k, 0, n).map(P));
  const L1 = lay(0.945), L2 = lay(0.79), L3 = lay(0.765), L4 = lay(0.745);
  const seedHalf = sg => { const pts = []; for (let i = 0; i <= 48; i++) { const a = -Math.PI / 2 + Math.PI * i / 48; pts.push([Math.cos(a) * SRX * 0.735 * sg, SFY + Math.sin(a) * SRY * 0.735]); } return ring(pts.map(P)); };
  const seedL = seedHalf(-1), seedR = seedHalf(1);
  const sfPed = tube2(P([0, Y1]), P([0, SFY + SRY - 4]), SC(5.6), SC(4.6));

  // ═══════════ 2. what stands in front: the burin stops at these ═══════════
  const occl = [];
  for (const f of FLW) {
    if (f.bud) { occl.push(...f.budR.polys); continue; }
    occl.push(...f.lobes.flatMap(l => l.polys), ...f.thr.polys);
    for (const st of f.stam) occl.push(st.ant.polys[0]);
  }
  for (const c of FRU) occl.push(...c.sh.polys);
  const occlB = occl.map(p => bboxOf([p]));
  const near = bb => occl.filter((_, i) => occlB[i][0] < bb[2] && occlB[i][2] > bb[0] && occlB[i][1] < bb[3] && occlB[i][3] > bb[1]);
  // cut a polyline where it runs behind something
  const clipRun = (pts, ws, ex) => {
    if (!ex.length) return [[pts, ws]];
    const out = []; let cp = null, cw = null;
    for (let i = 0; i < pts.length; i++) {
      if (inAny(ex, pts[i][0], pts[i][1])) { if (cp && cp.length > 1) out.push([cp, cw]); cp = null; cw = null; }
      else { if (!cp) { cp = []; cw = []; } cp.push(pts[i]); cw.push(ws[i]); }
    }
    if (cp && cp.length > 1) out.push([cp, cw]);
    return out;
  };

  // ═══════════════════════════════ 3. cut ═══════════════════════════════
  // Leaves overlap one another near the wood, so they are cut back to front: the lower pair lies
  // on top, and every leaf hands the ones below it to the burin as `excl`.
  const leafPolys = LG.flatMap(g => g.blade.polys);
  const frontOf = u => LG.filter(h => h.spec.u < u).flatMap(h => h.blade.polys);   // the lower leaves lie on top

  // ---- the branch ----
  ink.group('ol0'); outline(ink, branch.polys[0], { w: 2.4, light: LV, vary: 0.9, seed, run: 170 });
  const ocB = near(bboxOf(branch.polys));
  const exBr = [...leafPolys, ...ocB];
  ink.group('h1'); hatch(ink, branch.polys, { angle: Math.PI / 2, spacing: 3.3 * s, tone: brTone, thr: 0.14, wMax: 1.9, wMin: 0.18, seed: seed + 3, taper: 7, excl: exBr });
  ink.group('h2'); hatch(ink, branch.polys, { angle: 0.62, spacing: 3.7 * s, tone: brTone, thr: 0.50, wMax: 1.4, wMin: 0.18, seed: seed + 4, taper: 5, excl: exBr });
  ink.group('h3'); hatch(ink, branch.polys, { angle: -0.95, spacing: 4.3 * s, tone: brTone, thr: 0.76, wMax: 1.0, wMin: 0.18, seed: seed + 5, taper: 4, excl: exBr });
  // the bark: a few long fibres wandering up the wood
  {
    const Rb = RNG(seed + 6);
    for (let k = 0; k < 5; k++) {
      const off = (k - 2) * 0.32 + (Rb() - 0.5) * 0.1, pts = [], ws = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, u = 0.05 + 0.90 * t, w = hwB(u) * off * (1 + 0.22 * Math.sin(t * 9 + k * 2.3));
        pts.push(P([w, spineY(u)])); ws.push((0.35 + 1.5 * Math.abs(off)) * (0.6 + 0.5 * Math.sin(Math.PI * t)));
      }
      ink.group(k < 3 ? 'h1' : 'h2');
      for (const [p, w] of clipRun(pts, ws, exBr)) ink.add(p, w);
    }
  }
  reg('stem', branch);

  // ---- the leaves, from the tip of the branch downward ----
  for (const g of [...LG].sort((a, b) => b.spec.u - a.spec.u)) {
    const { spec, li, th, blade, ribW, midBand, lTone, VEINS, pet } = g;
    const ex = [...frontOf(spec.u), ...near(bboxOf(blade.polys))];
    const exB = [...midBand.polys, ...ex];
    // petiole
    ink.group('ol'); outline(ink, pet.polys[0], { w: 1.3, light: LV, vary: 0.6, seed: seed + 20 + li, excl: ex });
    ink.group('h2'); hatch(ink, pet.polys, { angle: th, spacing: 2.6 * s, tone: () => 0.55, thr: 0.3, wMax: 0.9, wMin: 0.18, seed: seed + 30 + li, taper: 2, excl: ex });
    // blade
    ink.group('ol'); outline(ink, blade.polys[0], { w: 1.9, light: LV, vary: 0.85, seed: seed + 40 + li, run: 120, pinch: 0.5, excl: ex });
    // midrib: one swelling stroke that thins to a hair before the tip
    ink.group('ol');
    ink.add(ribW, ribW.map((_, i) => { const v = i / 40; return (0.7 + 2.6 * Math.pow(1 - v, 0.8)) * (0.85 + 0.15 * Math.sin(v * 12 + 1)); }));
    // veins
    ink.group('ol');
    for (const [pts, ws] of VEINS) for (const [p, w] of clipRun(pts, ws, ex)) ink.add(p, w);
    const bend = -0.24 / (spec.len * s);
    ink.group('h1'); hatch(ink, blade.polys, { angle: th + Math.PI / 2 + 0.10, spacing: 3.2 * s, bend, a0: 0, tone: lTone, thr: 0.15, wMax: 1.8, wMin: 0.18, seed: seed + 50 + li, taper: 6, excl: exB });
    ink.group('h2'); hatch(ink, blade.polys, { angle: th + 0.42, spacing: 3.6 * s, tone: lTone, thr: 0.52, wMax: 1.35, wMin: 0.18, seed: seed + 60 + li, taper: 5, excl: exB });
    ink.group('h3'); hatch(ink, blade.polys, { angle: th - 0.85, spacing: 4.2 * s, tone: lTone, thr: 0.78, wMax: 0.95, wMin: 0.18, seed: seed + 70 + li, taper: 4, excl: exB });
  }
  // a dark at every joint: the petiole's shadow on the branch
  ink.group('h3');
  for (const spec of LEAVES) {
    const y0 = spineY(spec.u), hw = hwB(spec.u);
    for (const sg of [1, -1]) {
      const pts = [], ws = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(P([sg * hw * (1.02 + 0.10 * Math.sin(Math.PI * t)), y0 - 13 + 26 * t])); ws.push(0.5 + 1.1 * Math.sin(Math.PI * t)); }
      ink.add(pts, ws);
    }
  }

  // ---- the flowers ----
  const drawn = [];                                     // everything already in front of the paper
  for (const f of FLW) {
    ink.group('ol'); outline(ink, f.ped.polys[0], { w: 0.95, light: LV, vary: 0.6, seed: f.sd, excl: drawn });
    reg('stem', f.ped);
    if (f.bud) {
      ink.group('ol'); outline(ink, f.budR.polys[0], { w: 1.3, light: LV, vary: 0.9, seed: f.sd + 1, excl: drawn });
      ink.group('h1'); hatch(ink, f.budR.polys, { angle: f.bA + 0.7, spacing: 2.4 * s, tone: f.bt, thr: 0.40, wMax: 0.8, wMin: 0.18, seed: f.sd + 2, taper: 3, excl: drawn });
      reg('flower', f.budR); drawn.push(...f.budR.polys);
      continue;
    }
    const ft = sphereTone(f.cc[0], f.cc[1], f.R * 1.12, f.R * 1.12, { L, base: 0.0 });
    // each lobe is cut on its own, so the shading never runs across the gaps between petals
    for (let j = 0; j < 5; j++) {
      const lb = f.lobes[j];
      const ex = [...drawn, ...f.lobes.filter((_, m) => m !== j).flatMap(l => l.polys)];
      ink.group('ol'); outline(ink, lb.polys[0], { w: 2.0, light: LV, vary: 0.9, seed: f.sd + 3 + j, excl: ex });
      // a white flower is white because the burin leaves it alone; only the turn from the light is cut
      ink.group('h1'); hatch(ink, lb.polys, { angle: f.a + 0.5, spacing: 2.1 * s, tone: ft, thr: 0.14, wMax: 1.0, wMin: 0.18, seed: f.sd + 4 + j, taper: 3, excl: ex });
      ink.group('h2'); hatch(ink, lb.polys, { angle: f.a - 0.6, spacing: 2.7 * s, tone: ft, thr: 0.70, wMax: 0.7, wMin: 0.18, seed: f.sd + 5 + j, taper: 2, excl: ex });
      // the claw of the petal: a short fold, not a midrib — this is a petal, not a leaf
      ink.group('ol');
      const an = lb.ang, pts = [];
      for (let i = 0; i <= 6; i++) { const t = 0.22 + 0.50 * i / 6; pts.push([f.cc[0] + Math.cos(an) * f.R * t, f.cc[1] + Math.sin(an) * f.R * t]); }
      stroke(ink, pts, 0.6, { taper: 2, excl: ex });
      reg('flower', lb);
    }
    // the throat, the five stamens, and the style with its two-lobed stigma
    ink.group('ol'); outline(ink, f.thr.polys[0], { w: 0.9, light: LV, vary: 0.7, run: 0, excl: drawn });
    ink.group('h2'); hatch(ink, f.thr.polys, { angle: f.a, spacing: 1.4 * s, tone: () => 0.88, thr: 0.2, wMax: 0.75, wMin: 0.18, seed: f.sd + 6, taper: 1, excl: drawn });
    ink.group('ol');
    for (const st of f.stam) {
      stroke(ink, st.fil, 1.05, { taper: 2, excl: drawn });
      outline(ink, st.ant.polys[0], { w: 0.9, light: LV, vary: 0.3, run: 0, excl: drawn });
      ink.group('h3'); ink.dot(st.p1[0], st.p1[1], f.R * 0.030); ink.group('ol');
    }
    stroke(ink, [f.cc, [f.cc[0] + Math.cos(f.sa) * f.R * 0.34, f.cc[1] + Math.sin(f.sa) * f.R * 0.34], f.s1], 1.0, { taper: 2, excl: drawn });
    for (const g2 of [1, -1]) stroke(ink, [f.s1, [f.s1[0] + g2 * f.R * 0.14, f.s1[1] - f.R * 0.13]], 0.7, { taper: 1.5, excl: drawn });
    ink.group('h3');
    const Rg = RNG(f.sd + 7);
    for (let j = 0; j < 7; j++) {
      const px = f.s1[0] + (Rg() - 0.5) * f.R * 0.22, py = f.s1[1] + (Rg() - 0.5) * f.R * 0.20;
      if (!inAny(drawn, px, py)) ink.dot(px, py, f.R * 0.024);
    }
    drawn.push(...f.lobes.flatMap(l => l.polys), ...f.thr.polys);
    for (const st of f.stam) drawn.push(st.ant.polys[0]);
  }

  // ---- the cherries, back to front ----
  for (const c of FRU) {
    ink.group('ol'); outline(ink, c.ped.polys[0], { w: 1.0, light: LV, vary: 0.6, seed: c.sd });
    reg('stem', c.ped);
  }
  // a cluster is a pile of berries: only the ones in front of a berry may cut into it
  const cOrder = [...FRU].sort((a, b) => a.fw[1] - b.fw[1]);
  cOrder.forEach((c, i) => {
    const ex = cOrder.slice(i + 1).flatMap(o => o.sh.polys);
    ink.group('ol'); outline(ink, c.sh.polys[0], { w: 1.9, light: LV, vary: 0.85, seed: c.sd + 1, run: 70, excl: ex });
    const ft = sphereTone(c.fw[0], c.fw[1], c.H, c.Wd, { L, rot: c.a, base: 0.05 });
    ink.group('h1'); hatch(ink, c.sh.polys, { angle: c.a + 0.9, spacing: 3.0 * s, tone: ft, thr: 0.16, wMax: 1.5, wMin: 0.18, seed: c.sd + 3, taper: 4, excl: ex });
    ink.group('h2'); hatch(ink, c.sh.polys, { angle: c.a - 0.8, spacing: 3.4 * s, tone: ft, thr: 0.54, wMax: 1.1, wMin: 0.18, seed: c.sd + 5, taper: 3, excl: ex });
    // the persistent calyx: the small disc the flower left at the apex
    const ax = c.fw[0] + Math.cos(c.a) * c.H, ay = c.fw[1] + Math.sin(c.a) * c.H;
    ink.group('ol');
    outline(ink, ellipse(ax, ay, c.Wd * 0.17, c.Wd * 0.17, 0, 12).polys[0], { w: 0.9, light: LV, vary: 0.7, run: 0, excl: ex });
    for (let j = 0; j < 4; j++) { const an = c.a + (j - 1.5) * 0.42; stroke(ink, [[ax, ay], [ax + Math.cos(an) * c.Wd * 0.24, ay + Math.sin(an) * c.Wd * 0.24]], 0.55, { taper: 1.2, excl: ex }); }
    ink.group('h3'); ink.dot(ax, ay, 1.1 * s);
    reg('cherry', c.sh);
  });

  // ---- one fruit in longitudinal section, standing at the apex ----
  ink.group('ol'); outline(ink, sfPed.polys[0], { w: 1.1, light: LV, vary: 0.6, seed: seed + 200 });
  reg('stem', sfPed);
  // the cut face, outside in: exocarp, mesocarp (the flesh), the parchment endocarp, the silver skin
  ink.group('h1'); hatch(ink, sfO.polys, { angle: Math.PI / 2, spacing: 2.8 * s, tone: () => 0.86, thr: 0, wMax: 0.9, wMin: 0.40, seed: seed + 220, taper: 2, excl: L1.polys });
  ink.group('h1'); hatch(ink, L1.polys, { angle: 0.9, spacing: 3.2 * s, tone: () => 0.34, thr: 0.05, wMax: 0.9, wMin: 0.22, seed: seed + 221, taper: 3, excl: L2.polys });
  ink.group('h2'); hatch(ink, L2.polys, { angle: -0.6, spacing: 2.1 * s, tone: () => 0.58, thr: 0.10, wMax: 0.85, wMin: 0.22, seed: seed + 222, taper: 2, excl: L3.polys });
  ink.group('h3'); hatch(ink, L3.polys, { angle: 0.3, spacing: 1.6 * s, tone: () => 0.80, thr: 0.10, wMax: 0.8, wMin: 0.22, seed: seed + 223, taper: 2, excl: L4.polys });
  ink.group('ol');
  outline(ink, sfO.polys[0], { w: 2.1, light: LV, vary: 0.45, seed: seed + 201, run: 70 });
  outline(ink, L4.polys[0], { w: 1.3, light: LV, vary: 0.35, seed: seed + 224, run: 60 });
  // the two seeds lie face to face: one convex mass, so the light divides them down the seam
  {
    const c = P([0, SFY]);
    const st = sphereTone(c[0], c[1], SC(SRX * 0.735), SC(SRY * 0.735), { L, base: 0.02 });
    for (const [sd, sg] of [[seedL, -1], [seedR, 1]]) {
      ink.group('ol'); outline(ink, sd.polys[0], { w: 1.5, light: LV, vary: 0.35, seed: seed + 230 + (sg > 0 ? 1 : 0), run: 60 });
      ink.group('h1'); hatch(ink, sd.polys, { angle: 0.35, spacing: 2.1 * s, tone: st, thr: 0.14, wMax: 1.0, wMin: 0.2, seed: seed + 232 + (sg > 0 ? 1 : 0), taper: 3 });
      ink.group('h2'); hatch(ink, sd.polys, { angle: -0.9, spacing: 2.5 * s, tone: st, thr: 0.46, wMax: 0.85, wMin: 0.2, seed: seed + 234 + (sg > 0 ? 1 : 0), taper: 2 });
      reg('bean', sd);
    }
    // the seam where the two flat faces meet
    ink.group('ol');
    stroke(ink, [[c[0], c[1] - SC(SRY * 0.735)], [c[0], c[1] + SC(SRY * 0.735)]], 1.3, { taper: 8 });
  }
  // the calyx disc left at the apex of the fruit
  const capC = P([0, SFY - SRY]);
  ink.group('ol');
  outline(ink, ellipse(capC[0], capC[1], SC(9.0), SC(4.0), 0, 14).polys[0], { w: 0.9, light: LV, vary: 0.8, run: 0 });
  for (let j = 0; j < 5; j++) { const an = -Math.PI / 2 + (j - 2) * 0.42; stroke(ink, [capC, [capC[0] + Math.cos(an) * SC(15), capC[1] + Math.sin(an) * SC(9.0)]], 0.7, { taper: 1.5 }); }

  // ═══════════════════════════════ 4. regions & focus ═══════════════════════════════
  const mk = list => { const p = new Path2D(); for (const sh of list) p.addPath(sh.path); const pl = list.flatMap(sh => sh.polys); return { path: p, polys: pl, bbox: bboxOf(pl) }; };
  // `cherry` = the whole fruits plus the skin-and-flesh ring of the sectioned one (its cut face is a hole)
  const cPath = new Path2D();
  for (const sh of regions.cherry) cPath.addPath(sh.path);
  cPath.addPath(pathOf(sfO.polys[0])); cPath.addPath(pathOf(L2.polys[0], true));
  const cPolys = [...regions.cherry.flatMap(sh => sh.polys), ...sfO.polys, ...L2.polys];
  regions.cherry = { path: cPath, polys: cPolys, bbox: bboxOf(cPolys) };
  for (const k of ['leaf', 'flower', 'stem', 'bean']) regions[k] = mk(regions[k]);

  // focus points (world coordinates; eye is the fallback)
  const lf = LG[1 * 2].bc;                                  // the left blade of the second pair
  const fl = FLW.find(f => !f.bud), fr = FRU[0];
  const focus = {
    flower: { x: fl.cc[0], y: fl.cc[1], r: 100 * s },
    cherry: { x: fr.fw[0], y: fr.fw[1], r: 105 * s },
    seed: { x: P([0, SFY])[0], y: P([0, SFY])[1], r: 112 * s },
    leaf: { x: lf[0], y: lf[1], r: 118 * s },
    harbour: { x: P([-380, 40])[0], y: P([-380, 40])[1], r: 150 * s },
    eye: { x, y, r: 280 * s },
  };
  return { ink, regions, focus, center: [x, y], s };
}
