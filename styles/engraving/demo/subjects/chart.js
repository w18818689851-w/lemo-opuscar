// chart.js — the sea chart along the foot of the plate: the coffee voyage, from the Ethiopian highlands
// out into the world and back. This is NOT a subject (see engraving-authoring-contract.md §1): it has no
// 'ol0' first stroke, no `focus` and no roundels — it is plate furniture the film calls itself.
//
//   buildChart({ x0, y0, x1, y1, seed }) → { ink, stations, route, rose, regions }
//
//   ink groups (the film schedules them; none is 'ol0'):
//     'col'   the coast — the continent's outline and the islands
//     'ch1'   the first family: shore lines ruled along the coast, then the ruling that fills the land
//     'ch2'   the crossing family, kept in the dark coastal band
//     'rose'  the compass rose: double rule, graduated ring, eight-point star, compass rays
//     'route' the track: a dotted trail of short burin ticks, arced leg by leg
//     'stat'  the station rings: a double rule round each port
//     'scale' the graduated frame of the band + the scale bar
//   stations: world points in voyage order (kaffa … kenya) — the film engraves their names itself
//   regions:  land / sea, for the colourist (sea-green over the sea; the land keeps the paper)
import * as B from '../engine/burin.js';
const { ring, outline, stroke, hatch, hatchAlong, clamp, mix, sstep, noise1, noise2, inPoly, ellipsePts, bboxOf, polyArea, resample, normals } = B;
const L = { x: -0.55, y: -0.62, z: 0.56 }, LV = [L.x, L.y];

// A Hermite run through a hand-generalised coast: the engraver keeps a few true headlands and invents the
// rest. The ends are pinned (the coast meets the frame edge squarely) and the tension is low, so a narrow
// bay or a slit never closes itself up.
function run(pts, per = 6, k = 0.32) {
  const n = pts.length, out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const m1 = i === 0 ? [0, 0] : [(p2[0] - p0[0]) * k, (p2[1] - p0[1]) * k];
    const m2 = i === n - 2 ? [0, 0] : [(p3[0] - p1[0]) * k, (p3[1] - p1[1]) * k];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      const a = 2 * t3 - 3 * t2 + 1, b = t3 - 2 * t2 + t, c = -2 * t3 + 3 * t2, d = t3 - t2;
      out.push([a * p1[0] + b * m1[0] + c * p2[0] + d * m2[0], a * p1[1] + b * m1[1] + c * p2[1] + d * m2[1]]);
    }
  }
  out.push(pts[n - 1]);
  return out;
}
function loop(pts, per = 6, k = 0.26) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const m1 = [(p2[0] - p0[0]) * k, (p2[1] - p0[1]) * k], m2 = [(p3[0] - p1[0]) * k, (p3[1] - p1[1]) * k];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      const a = 2 * t3 - 3 * t2 + 1, b = t3 - 2 * t2 + t, c = -2 * t3 + 3 * t2, d = t3 - t2;
      out.push([a * p1[0] + b * m1[0] + c * p2[0] + d * m2[0], a * p1[1] + b * m1[1] + c * p2[1] + d * m2[1]]);
    }
  }
  return out;
}
// one leg of the track: a circular arc bowed through a displaced midpoint (the 17th-c. way of ruling a course)
function arc(a, b, sag, side) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const px = -dy / len * side, py = dx / len * side;
  const cx = 2 * (mx + px * sag) - mx, cy = 2 * (my + py * sag) - my;
  const n = Math.max(10, Math.ceil(len / 8)), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
  }
  return out;
}
// which way is inland from a guide line? (so the shore lines fall on the land, whatever way the ring runs)
function inward(polys, guide) {
  const G = resample(guide, 3), N = normals(G, false);
  for (let i = 0; i < G.length; i++) {
    if (inPoly(polys, G[i][0] + N[i][0] * 3, G[i][1] + N[i][1] * 3)) return 1;
    if (inPoly(polys, G[i][0] - N[i][0] * 3, G[i][1] - N[i][1] * 3)) return -1;
  }
  return 1;
}

export function buildChart({ x0 = 140, y0 = 838, x1 = 1780, y1 = 1012, seed = 21 } = {}) {
  const ink = new B.Ink();
  // the band's ruled frame — kept clear of the plate's double border, whose hairline sits at y = 999
  const F = [x0 + 8, y0 + 8, x1 - 8, y1 - 22];        // 148, 846 … 1772, 990
  const U = u => F[0] + u * (F[2] - F[0]), V = v => F[1] + v * (F[3] - F[1]);
  // the coast is generalised twice: once by the run above, once by a hair of crenellation
  const cren = (u, v, k) => [u + ((noise1(u * 131 + v * 29, seed + k) - 0.5) * 0.0013 + (noise1(u * 43 + v * 11, seed + k + 3) - 0.5) * 0.0022),
                             v + ((noise1(v * 124 + u * 23, seed + 40 + k) - 0.5) * 0.0115 + (noise1(v * 46 + u * 9, seed + 43 + k) - 0.5) * 0.019)];
  const coast = (pts, per, k, closed) => {
    const s = closed ? loop(pts, per) : run(pts, per);
    return s.map(q => { const w = cren(q[0], q[1], k); return [U(w[0]), V(w[1])]; });
  };

  // ---------- the land ----------
  // One generalised continent: Iberia, the Middle Sea (a long pocket, its mouth a strait at Gibraltar, its
  // head at the Levant), Africa's north coast, the western bulge, the Cape, the east coast, the Horn, the
  // Red Sea (a thin diagonal slit, Sinai between it and the Middle Sea), Arabia, then the coast of Asia
  // running off the top of the chart.
  const MAIN = [
    [0.400, 0.000], [0.404, 0.066], [0.392, 0.132], [0.402, 0.188], [0.418, 0.236], [0.438, 0.272],
    [0.454, 0.300],                                                    // Gibraltar, north side
    [0.474, 0.256], [0.494, 0.282], [0.514, 0.252], [0.534, 0.278], [0.554, 0.248],
    [0.574, 0.274], [0.594, 0.250], [0.614, 0.276], [0.634, 0.252], [0.650, 0.272],
    [0.660, 0.290],                                                    // the bay's head (the Levant)
    [0.650, 0.346], [0.628, 0.360], [0.604, 0.386], [0.580, 0.366],
    [0.556, 0.392], [0.532, 0.372], [0.508, 0.396], [0.484, 0.382], [0.462, 0.386],
    // Africa's west coast, south
    [0.452, 0.436], [0.442, 0.484], [0.430, 0.528], [0.418, 0.568], [0.408, 0.606],
    [0.412, 0.640], [0.428, 0.672], [0.448, 0.700], [0.470, 0.726], [0.492, 0.748],
    [0.512, 0.766], [0.532, 0.784], [0.552, 0.800],                    // the Cape of Good Hope
    [0.572, 0.812], [0.590, 0.804],
    // Africa's east coast, north
    [0.602, 0.778], [0.616, 0.752], [0.632, 0.726], [0.648, 0.700], [0.664, 0.676],
    [0.682, 0.652], [0.700, 0.630], [0.718, 0.610], [0.736, 0.592], [0.752, 0.578],
    [0.762, 0.572],                                                    // the Horn
    // the Red Sea: Africa's shore, north-west (a long thin slit, the two shores well apart)
    [0.752, 0.590], [0.740, 0.566], [0.728, 0.542], [0.716, 0.518], [0.706, 0.494],
    [0.698, 0.470], [0.692, 0.446], [0.690, 0.424],                    // Suez, the head of the slit
    // the Red Sea: Arabia's shore, back south-east
    [0.696, 0.352], [0.704, 0.378], [0.714, 0.402], [0.724, 0.426], [0.736, 0.450],
    [0.748, 0.474], [0.760, 0.498], [0.772, 0.522],                    // Bab-el-Mandeb
    // Arabia's south coast, east
    [0.788, 0.574], [0.808, 0.570], [0.828, 0.546], [0.846, 0.518], [0.862, 0.486],
    [0.874, 0.450], [0.882, 0.412], [0.888, 0.376],
    // the coast of Asia, running north-east off the chart
    [0.896, 0.340], [0.908, 0.306], [0.920, 0.270], [0.930, 0.232], [0.938, 0.192],
    [0.944, 0.150], [0.948, 0.104], [0.950, 0.054], [0.950, 0.000],
  ];
  const mainPts = coast(MAIN, 5, 1, false), main = ring(mainPts);
  // Brazil: a coast running off the foot of the chart, west across the Atlantic
  const BRAZIL = [
    [0.118, 0.856], [0.132, 0.822], [0.152, 0.800], [0.176, 0.814], [0.196, 0.798],
    [0.220, 0.822], [0.244, 0.854], [0.262, 0.884], [0.272, 0.916], [0.258, 0.958],
    [0.236, 1.000], [0.150, 1.000], [0.118, 0.928],
  ];
  const brazilPts = coast(BRAZIL, 6, 2, false), brazil = ring(brazilPts);
  const ISLES = [
    [[0.292, 0.196], [0.300, 0.140], [0.296, 0.086], [0.310, 0.038], [0.330, 0.020], [0.352, 0.036],
     [0.362, 0.086], [0.356, 0.140], [0.340, 0.186], [0.316, 0.204]],                   // Britain
    [[0.266, 0.052], [0.282, 0.042], [0.292, 0.076], [0.284, 0.118], [0.266, 0.104]],   // Ireland
    [[0.958, 0.128], [0.978, 0.108], [0.996, 0.130], [0.992, 0.176], [0.972, 0.188], [0.956, 0.166]],
    [[0.962, 0.256], [0.984, 0.242], [0.998, 0.276], [0.988, 0.312], [0.966, 0.300]],
    [[0.958, 0.380], [0.976, 0.368], [0.986, 0.398], [0.970, 0.420]],                   // the Sunda isles
    [[0.706, 0.846], [0.724, 0.832], [0.736, 0.870], [0.722, 0.902], [0.706, 0.884]],   // Madagascar
    [[0.118, 0.674], [0.132, 0.664], [0.140, 0.692], [0.126, 0.706], [0.114, 0.696]],   // Martinique
    [[0.090, 0.640], [0.100, 0.632], [0.106, 0.654], [0.094, 0.664]],
    [[0.150, 0.726], [0.160, 0.718], [0.164, 0.740], [0.152, 0.748]],
    [[0.318, 0.606], [0.330, 0.598], [0.336, 0.622], [0.322, 0.630]],                   // the Canaries
  ];
  const isles = ISLES.map((d, i) => ring(coast(d, 6, 10 + i, true)));
  const LANDS = [main, brazil, ...isles];
  const landPolys = LANDS.flatMap(s => s.polys);

  // ---------- the coast, cut first ----------
  ink.group('col');
  outline(ink, main.polys[0], { w: 1.9, light: LV, vary: 0.85, run: 130, pinch: 0.5, grain: 0.16, step: 1.6, seed });
  for (const s of [brazil, ...isles]) outline(ink, s.polys[0], { w: 1.5, light: LV, vary: 0.8, run: 80, pinch: 0.5, grain: 0.18, step: 1.6, seed: seed + 3 });

  // ---------- the stations, placed before the ruling so each name gets clear ground ----------
  // A port is fixed by its position on the chart, not by the drawing order; the engraver rules the land
  // first and then leaves a window where the name will be cut, so the lettering never fights the hatching.
  const ST = {
    kaffa: { x: U(0.660), y: V(0.600), label: 'KAFFA' },
    mocha: { x: U(0.762), y: V(0.452), label: 'MOCHA' },
    constantinople: { x: U(0.668), y: V(0.246), label: 'CONSTANTINOPLE' },
    venice: { x: U(0.558), y: V(0.250), label: 'VENICE' },
    london: { x: U(0.325), y: V(0.150), label: 'LONDON' },
    java: { x: U(0.930), y: V(0.505), label: 'JAVA' },
    martinique: { x: U(0.135), y: V(0.680), label: 'MARTINIQUE' },
    brazil: { x: U(0.205), y: V(0.820), label: 'BRAZIL' },
    kenya: { x: U(0.730), y: V(0.606), label: 'KENYA' },
  };
  const stations = ST;

  // ---------- the land: tone darkens toward its own coast (the engraver's shore shading) ----------
  // the tone field is only ever read through a 19 px shore ramp and a bilinear sampler, so a 7 px grid is
  // already finer than the ruling can show: res 440 cost ~390 ms of the page's READY for no visible gain.
  const FT = B.formTone(landPolys, { res: 220, light: [-0.6, -0.7] });
  const STV = Object.values(ST);
  const nameGap = (x, y) => {                       // 1 inside a name window, 0 well outside it
    let m = 0;
    for (const s of STV) m = Math.max(m, 1 - sstep(11, 28, Math.hypot(x - s.x, y - s.y)));
    return m;
  };
  const landTone = (x, y) => clamp(0.12 + 0.60 * (1 - sstep(0, 19, FT.df(x, y))) + 0.19 * noise2(x / 26, y / 26, seed)
                                   - 0.06 * (y - F[1]) / (F[3] - F[1]) - 0.78 * nameGap(x, y));
  ink.group('ch1');
  // the shore: three hairlines ruled parallel to the coast, thickening as they close on it
  for (const pts of [mainPts, brazilPts]) {
    const s = inward(landPolys, pts);
    hatchAlong(ink, landPolys, pts, {
      spacing: 4.2 * s, from: 1, to: 3, tone: () => 1, thr: 0, wMin: 0.16, wMax: 0.42,
      taper: 7, seed: seed + 9, step: 3, wobble: 0.5,
    });
  }
  // the ruling that fills the land: hair-fine inland, biting where the land turns from the light,
  // and broken, so it reads as cut and not as ruled paper
  hatch(ink, landPolys, {
    angle: -0.12, spacing: 4.4, tone: landTone, thr: 0.10, wMin: 0.14, wMax: 0.95, gamma: 1.05,
    seed: seed + 1, taper: 6, jitter: 0.18, wobble: 0.4, swell: 0.86, step: 2.2, dash: 0.06,
  });
  ink.group('ch2');
  hatch(ink, landPolys, {
    angle: 0.80, spacing: 4.8, tone: landTone, thr: 0.50, wMin: 0.14, wMax: 0.72,
    seed: seed + 4, taper: 5, jitter: 0.2, wobble: 0.45, swell: 0.85, step: 2.2, dash: 0.05,
  });

  // ---------- the compass rose, in the western sea ----------
  const rose = { x: U(0.0505), y: V(0.498), r: 60 };
  ink.group('rose');
  const circ = (cx, cy, r, w, o = {}) => outline(ink, ellipsePts(cx, cy, r, r, 0, Math.max(36, Math.round(r * 1.5))), {
    w, vary: 0.22, run: r * 1.4, pinch: 0.32, grain: 0.05, seed: seed + 20, ...o,
  });
  // the rhumb rays every old chart keeps by its rose: hairlines fanned out until they reach land
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + 0.19, dx = Math.cos(a), dy = Math.sin(a);
    const pts = [], ws = [];
    for (let k = 0; k <= 52; k++) {
      const d = rose.r + 4 + k * 4.0, x = rose.x + dx * d, y = rose.y + dy * d;
      if (x < F[0] + 6 || x > F[2] - 6 || y < F[1] + 6 || y > F[3] - 6 || inPoly(landPolys, x, y)) break;
      pts.push([x, y]); ws.push(0.30 + 0.22 * noise1(k * 0.5 + i * 3, seed));
    }
    if (pts.length > 6) ink.add(pts, ws);
  }
  circ(rose.x, rose.y, rose.r, 1.5);
  circ(rose.x, rose.y, rose.r - 7.5, 0.5, { vary: 0.14 });
  for (let i = 0; i < 60; i++) {                                  // a tick every 6°, longer every 30°
    const a = i * Math.PI / 30 - Math.PI / 2, long = i % 5 === 0;
    const d0 = rose.r - 7.5, d1 = rose.r - (long ? 1.2 : 3.6);
    ink.add([[rose.x + Math.cos(a) * d0, rose.y + Math.sin(a) * d0], [rose.x + Math.cos(a) * d1, rose.y + Math.sin(a) * d1]],
      [0.30, long ? 0.85 : 0.45]);
  }
  for (let i = 0; i < 8; i++) {                                   // the eight-point star, shadow half hatched
    const a = i * Math.PI / 4 - Math.PI / 2, card = i % 2 === 0;
    const len = rose.r * (card ? 0.80 : 0.52), half = len * 0.125;
    const dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
    const wx = rose.x + dx * len * 0.30, wy = rose.y + dy * len * 0.30;
    const tip = [rose.x + dx * len, rose.y + dy * len];
    const s1 = [wx + px * half, wy + py * half], s2 = [wx - px * half, wy - py * half];
    outline(ink, ring([[rose.x, rose.y], s1, tip, s2]).polys[0], { w: 0.72, vary: 0.3, run: 34, pinch: 0.4, grain: 0.06, seed: seed + 40 + i });
    hatch(ink, ring([[rose.x, rose.y], s1, tip]).polys, {
      angle: a, spacing: 1.9, tone: () => 1, thr: 0, wMin: 0.32, wMax: 0.62,
      seed: seed + 60 + i, swell: 0.4, taper: 1.4, step: 1.4, wobble: 0.12,
    });
  }
  ink.dot(rose.x, rose.y, 1.1);

  // ---------- the stations: a double rule round each port ----------
  const ORDER = ['kaffa', 'mocha', 'constantinople', 'venice', 'london', 'java', 'martinique', 'brazil', 'kenya'];
  ink.group('stat');
  for (const [i, k] of ORDER.entries()) {
    const s = stations[k], R = 11.5;
    outline(ink, ellipsePts(s.x, s.y, R, R, 0, 40), { w: 1.35, vary: 0.24, run: 62, pinch: 0.34, grain: 0.06, seed: seed + 120 + i });
    outline(ink, ellipsePts(s.x, s.y, R * 0.60, R * 0.60, 0, 28), { w: 0.55, vary: 0.18, run: 40, pinch: 0.3, grain: 0.05, seed: seed + 140 + i });
    ink.dot(s.x, s.y, 0.85);
  }

  // ---------- the track ----------
  // The London–Java leg is the long way — down the Atlantic, round the Cape, up the Indian Ocean — and the
  // Brazil–Kenya leg rounds the Cape too, so the trail carries three course waypoints between the ports.
  // The nine ports are still in voyage order inside `route`.
  const w1 = { x: U(0.390), y: V(0.720) };      // the Atlantic, off the Guinea coast
  const w2 = { x: U(0.560), y: V(0.905) };      // south of the Cape, outbound
  const w3 = { x: U(0.700), y: V(0.872) };      // south of Africa, homeward
  const Q = k => [stations[k].x, stations[k].y];
  const seq = [
    ...arc(Q('kaffa'), Q('mocha'), 14, -1),
    ...arc(Q('mocha'), Q('constantinople'), 14, -1),
    ...arc(Q('constantinople'), Q('venice'), 10, -1),
    ...arc(Q('venice'), Q('london'), 30, -1),
    ...arc(Q('london'), [w1.x, w1.y], 12, 1),
    ...arc([w1.x, w1.y], [w2.x, w2.y], 10, 1),
    ...arc([w2.x, w2.y], Q('java'), 34, 1),
    ...arc(Q('java'), Q('martinique'), 62, -1),
    ...arc(Q('martinique'), Q('brazil'), 8, -1),
    ...arc(Q('brazil'), [w3.x, w3.y], 5, 1),
    ...arc([w3.x, w3.y], Q('kenya'), 8, 1),
  ];
  const route = seq.map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
  ink.group('route');
  let acc = 0;
  for (let i = 1; i < seq.length; i++) {
    const [ax, ay] = seq[i - 1], [bx, by] = seq[i], d = Math.hypot(bx - ax, by - ay);
    if (d < 1e-6) continue;
    const ux = (bx - ax) / d, uy = (by - ay) / d;
    for (let s = acc % 9; s < d - 1.5; s += 9) {
      const w = 0.85 + 0.45 * noise1((acc + s) * 0.055, seed + 7);
      ink.add([[ax + ux * s, ay + uy * s], [ax + ux * (s + 2.1), ay + uy * (s + 2.1)], [ax + ux * (s + 4.2), ay + uy * (s + 4.2)]],
        [0.34, w, 0.34]);
    }
    acc += d;
  }

  // ---------- the graduated frame and the scale bar ----------
  ink.group('scale');
  outline(ink, [[F[0], F[1]], [F[2], F[1]], [F[2], F[3]], [F[0], F[3]]],
    { w: 1.7, vary: 0.16, run: 130, pinch: 0.34, grain: 0.05, step: 3, seed: seed + 80 });
  outline(ink, [[F[0] + 5, F[1] + 5], [F[2] - 5, F[1] + 5], [F[2] - 5, F[3] - 5], [F[0] + 5, F[3] - 5]],
    { w: 0.5, vary: 0.12, run: 90, pinch: 0.3, grain: 0.04, step: 3, seed: seed + 81 });
  const NX = 40, NY = 5;
  for (let i = 0; i <= NX; i++) {
    const x = mix(F[0], F[2], i / NX), big = i % 5 === 0, l = big ? 6.0 : 3.4, w = big ? 0.78 : 0.48;
    stroke(ink, [[x, F[1]], [x, F[1] + l]], w, { taper: 0.9, step: 1 });
    stroke(ink, [[x, F[3]], [x, F[3] - l]], w, { taper: 0.9, step: 1 });
  }
  for (let j = 1; j < NY; j++) {
    const y = mix(F[1], F[3], j / NY);
    stroke(ink, [[F[0], y], [F[0] + 4.6, y]], 0.48, { taper: 0.9, step: 1 });
    stroke(ink, [[F[2], y], [F[2] - 4.6, y]], 0.48, { taper: 0.9, step: 1 });
  }
  // the scale bar: a ruled bar whose alternate divisions are hatched solid (the engraver's "black" is line)
  {
    const bx0 = U(0.098), bx1 = U(0.238), byc = V(0.118), hh = 5.0, n = 8, sw = (bx1 - bx0) / n;
    for (let i = 0; i < n; i += 2) {
      const xa = bx0 + i * sw + 0.4, xb = xa + sw - 0.8;
      hatch(ink, ring([[xa, byc - hh + 0.6], [xb, byc - hh + 0.6], [xb, byc + hh - 0.6], [xa, byc + hh - 0.6]]).polys,
        { angle: Math.PI / 2, spacing: 1.7, tone: () => 1, thr: 0, wMin: 0.42, wMax: 0.78, seed: seed + 200 + i, swell: 0.22, taper: 1.2, step: 1.2, wobble: 0.1 });
    }
    outline(ink, [[bx0, byc - hh], [bx1, byc - hh], [bx1, byc + hh], [bx0, byc + hh]],
      { w: 0.72, vary: 0.12, run: 60, pinch: 0.3, grain: 0.04, step: 2, seed: seed + 210 });
    for (let i = 1; i < n; i++) { const x = bx0 + i * sw; stroke(ink, [[x, byc - hh], [x, byc + hh]], 0.42, { taper: 0.9, step: 1.5 }); }
  }

  // ---------- regions for the colourist ----------
  const mk = list => { const p = new Path2D(); for (const sh of list) p.addPath(sh.path); return { path: p, polys: list.flatMap(sh => sh.polys), bbox: bboxOf(list.flatMap(sh => sh.polys)) }; };
  const rect = [[F[0], F[1]], [F[2], F[1]], [F[2], F[3]], [F[0], F[3]]];
  const rs = polyArea(rect);
  // the sea is the frame less the land: the land rings are wound against the frame, so one fill leaves them dry
  const holes = landPolys.map(p => polyArea(p) * rs > 0 ? p.slice().reverse() : p);
  const seaPolys = [rect, ...holes];
  const seaPath = new Path2D();
  for (const p of seaPolys) { p.forEach(([x, y], k) => k ? seaPath.lineTo(x, y) : seaPath.moveTo(x, y)); seaPath.closePath(); }
  const regions = {
    land: { path: mk(LANDS).path, polys: landPolys, bbox: bboxOf(landPolys) },
    sea: { path: seaPath, polys: seaPolys, bbox: bboxOf(seaPolys) },
  };

  return { ink, stations, route, rose, regions };
}
