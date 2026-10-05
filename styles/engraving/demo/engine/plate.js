// plate.js — the printed sheet around an engraving: laid paper, the pressed plate mark, ruled border,
// engraved lettering (roman capitals and copperplate script), magnification roundels and leader lines.
// Everything draws in world coordinates under the camera transform, so it stays sharp at any zoom.
import * as B from './burin.js';
const { clamp, RNG, noise2, sstep } = B;

export const PAL = {
  paper: '#f1e8d2', plateTone: '#e8ddc2', ink: '#1c1510', inkSoft: '#3a2c20', foxing: '#9a6a34',
  bevelDark: 'rgba(96,70,40,0.42)', bevelLight: 'rgba(255,251,240,0.95)',
};
export const FONTS = { roman: 'Bodoni Moda', script: 'Pinyon Script' };
// Language font sets: the film calls setFonts({ roman, script }) once at start-up to swap in another
// script's faces (e.g. a CJK cut). It mutates FONTS in place, so every importer and every per-call
// default (`font = FONTS.roman`) keeps seeing the live values. Never called => the Latin defaults stand.
export function setFonts(f) { if (f) for (const k of Object.keys(f)) if (f[k]) FONTS[k] = f[k]; return FONTS; }

// ---------- paper: a world-space texture (laid lines, fibres, foxing), built once ----------
let paperCache = null;
export function paperTexture(W = 1920, H = 1080, seed = 53) {
  if (paperCache && paperCache.W === W && paperCache.H === H) return paperCache.c;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), R = RNG(seed);
  const im = g.createImageData(W, H), d = im.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = noise2(x / 2.2, y / 2.2, 1) * 0.45 + noise2(x / 34, y / 34, 2) * 0.35 + noise2(x / 190, y / 190, 3) * 0.45;
    const laid = (y % 4 === 0 ? 0.03 : 0) + (x % 72 < 1 ? 0.035 : 0);
    const v = 255 - (n * 13 + laid * 90);
    const i = (y * W + x) * 4; d[i] = v; d[i + 1] = v - 1.5; d[i + 2] = v - 6; d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  // fibres
  g.globalAlpha = 0.06; g.strokeStyle = '#6b5030'; g.lineWidth = 0.6;
  for (let k = 0; k < 900; k++) { const x = R() * W, y = R() * H, a = R() * 6.28, l = 3 + R() * 9; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.6, y + Math.sin(a + 0.6) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  // foxing: small rust spots, mostly toward the edges
  for (let k = 0; k < 70; k++) { let x = R() * W, y = R() * H; if (R() < 0.7) { if (R() < 0.5) x = R() < 0.5 ? R() * 120 : W - R() * 120; else y = R() < 0.5 ? R() * 90 : H - R() * 90; } const r = 1 + R() * 5; g.globalAlpha = 0.05 + R() * 0.1; g.fillStyle = PAL.foxing; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  paperCache = { W, H, c };
  return c;
}

// the sheet: paper, plate tone inside the plate mark, the bevel of the mark (debossed, lit from the upper left)
export function drawSheet(ctx, { W = 1920, H = 1080, plate = [70, 44, 1850, 1036], tone = 1 } = {}) {
  const [x0, y0, x1, y1] = plate;
  ctx.save();
  ctx.fillStyle = PAL.paper; ctx.fillRect(-2000, -2000, W + 4000, H + 4000);
  ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(paperTexture(W, H), 0, 0, W, H);
  // plate tone: the thin film of ink the printer leaves when wiping the plate
  ctx.globalAlpha = 0.55 * tone; ctx.fillStyle = PAL.plateTone; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // the bevel: top and left walls turn from the light, bottom and right catch it
  const b = 5;
  ctx.fillStyle = PAL.bevelDark;
  ctx.beginPath(); ctx.moveTo(x0 - b, y0 - b); ctx.lineTo(x1 + b, y0 - b); ctx.lineTo(x1, y0); ctx.lineTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x0 - b, y1 + b); ctx.closePath(); ctx.fill();
  ctx.fillStyle = PAL.bevelLight;
  ctx.beginPath(); ctx.moveTo(x1 + b, y0 - b); ctx.lineTo(x1 + b, y1 + b); ctx.lineTo(x0 - b, y1 + b); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(90,64,36,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(x0 - b, y0 - b, x1 - x0 + 2 * b, y1 - y0 + 2 * b);
  ctx.restore();
}

// ruled border: a heavy line and a hairline, cut as ink so it can be engraved in time
export function borderInk(ink, [x0, y0, x1, y1], { gap = 9 } = {}) {
  B.outline(ink, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { w: 2.4, vary: 0.15, grain: 0.04, step: 4 });
  B.outline(ink, [[x0 + gap, y0 + gap], [x1 - gap, y0 + gap], [x1 - gap, y1 - gap], [x0 + gap, y1 - gap]], { w: 0.8, vary: 0.1, grain: 0.04, step: 4 });
}

// ---------- engraved lettering ----------
// Roman capitals are cut glyph by glyph (each glyph wipes in from the left, as the burin travels);
// script is written in one continuous stroke from left to right with a soft wet edge.
// A font value is either a bare family ("Noto Serif SC") or an already-quoted stack
// ('"Bodoni Moda", "Noto Serif SC"'); only the bare one gets quoted, so a stack survives as valid CSS.
const fontSpec = f => /[,"']/.test(f) ? f : `"${f}"`;
export function measure(ctx, str, { size = 40, font = FONTS.roman, weight = 500, italic = false, track = 0 } = {}) {
  ctx.save(); ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${fontSpec(font)}`;
  const chars = [...str], ws = chars.map(ch => ctx.measureText(ch).width), tw = ws.reduce((a, b) => a + b, 0) + track * size * Math.max(0, chars.length - 1);
  ctx.restore(); return { chars, ws, tw };
}
export function engraveText(ctx, str, x, y, o = {}) {
  const { size = 40, font = FONTS.roman, weight = 500, italic = false, track = 0, align = 'center', color = PAL.ink, p = 1, alpha = 1 } = o;
  if (p <= 0 || !str) return;
  const { chars, ws, tw } = measure(ctx, str, o);
  ctx.save(); ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${fontSpec(font)}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = alpha;
  let cx = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
  const N = chars.length, shown = p * (N + 2);
  for (let i = 0; i < N; i++) {
    const f = clamp(shown - i * 1.0 - 0.5, 0, 1.5) / 1.5;
    if (f > 0) {
      if (f < 1) { ctx.save(); ctx.beginPath(); ctx.rect(cx - 2, y - size * 1.2, (ws[i] + 4) * f, size * 1.6); ctx.clip(); ctx.fillText(chars[i], cx, y); ctx.restore(); }
      else ctx.fillText(chars[i], cx, y);
    }
    cx += ws[i] + track * size;
  }
  ctx.restore();
}
export function writeScript(ctx, str, x, y, o = {}) {
  const { size = 40, font = FONTS.script, color = PAL.ink, align = 'center', p = 1, alpha = 1, weight = 400 } = o;
  if (p <= 0 || !str) return;
  ctx.save(); ctx.font = `${weight} ${size}px ${fontSpec(font)}`; ctx.textBaseline = 'alphabetic';
  const tw = ctx.measureText(str).width, x0 = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
  const edge = x0 - size * 0.3 + (tw + size * 0.6) * clamp(p);
  ctx.globalAlpha = alpha;
  if (p < 1) {
    const g = ctx.createLinearGradient(edge - size * 0.9, 0, edge, 0); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.rect(x0 - size, y - size * 1.5, edge - x0 + size, size * 2.2); ctx.clip(); ctx.fillStyle = g;
    // solid part
    ctx.save(); ctx.beginPath(); ctx.rect(x0 - size, y - size * 1.5, Math.max(0, edge - size * 0.9 - x0 + size), size * 2.2); ctx.clip(); ctx.fillStyle = color; ctx.fillText(str, x0, y); ctx.restore();
    ctx.fillText(str, x0, y);
  } else { ctx.fillStyle = color; ctx.fillText(str, x0, y); }
  ctx.restore();
}
// fit a string into a width: shrink to minSize, then wrap into two lines
export function fitLines(ctx, str, maxW, o) {
  let size = o.size; const min = o.minSize ?? o.size * 0.8;
  for (; size >= min; size -= 1) { if (measure(ctx, str, { ...o, size }).tw <= maxW) return { lines: [str], size }; }
  const words = str.split(' '); let best = null;
  for (let k = 1; k < words.length; k++) { const a = words.slice(0, k).join(' '), b = words.slice(k).join(' '), w = Math.max(measure(ctx, a, { ...o, size: o.size }).tw, measure(ctx, b, { ...o, size: o.size }).tw); if (!best || w < best.w) best = { w, lines: [a, b] }; }
  size = o.size; while (size > min * 0.85 && best.w * size / o.size > maxW) size -= 1;
  return { lines: best.lines, size };
}

// ---------- roundel: a magnification in a double-ruled circle ----------
// content: { ink, regions } built for radius 500 local units. The roundel draws at centre (x, y) with radius r.
export function roundelFrame(ctx, x, y, r, { p = 1, w = 2.2 } = {}) {
  if (p <= 0) return;
  // r comes from the film's layout as RR * S, with S = min(W/1920, H/1080). On a very small frame S
  // collapses, and the inner ring's `r - offset` (offset = max(3.5, r*0.035)) goes negative — which
  // ctx.arc() rejects with IndexSizeError, an uncaught throw that kills the whole render. Clamp the two
  // radii to 0 so a tiny frame degrades to a degenerate ring instead of throwing. Both quantities are
  // positive at any ordinary frame, so this is a no-op there (1920×1080 stays bit-identical).
  const rOut = Math.max(0, r), rIn = Math.max(0, r - Math.max(3.5, r * 0.035));
  ctx.save(); ctx.strokeStyle = PAL.ink; ctx.lineCap = 'round';
  const a0 = -Math.PI / 2 - 0.4, a1 = a0 + Math.PI * 2 * clamp(p);
  ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, rOut, a0, a1); ctx.stroke();
  ctx.lineWidth = w * 0.38; ctx.beginPath(); ctx.arc(x, y, rIn, a0, a0 + Math.PI * 2 * clamp(p * 1.1 - 0.1)); ctx.stroke();
  ctx.restore();
}
// leader line from a point on the figure to the rim of a roundel, with a tiny reference number near its root
export function leader(ctx, from, to, { p = 1, w = 0.9, num = null, numP = 1, size = 16 } = {}) {
  if (p <= 0) return;
  const x = from[0] + (to[0] - from[0]) * clamp(p), y = from[1] + (to[1] - from[1]) * clamp(p);
  ctx.save(); ctx.strokeStyle = PAL.ink; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(x, y); ctx.stroke();
  ctx.fillStyle = PAL.ink; ctx.beginPath(); ctx.arc(from[0], from[1], w * 1.6, 0, 7); ctx.fill();
  ctx.restore();
  if (num != null && numP > 0) {
    const dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const m = [from[0] + dx * 0.16 + nx * 12, from[1] + dy * 0.16 + ny * 12 + size * 0.35];
    engraveText(ctx, num, m[0], m[1], { size, italic: true, weight: 500, p: numP });
  }
}
// ---------- CJK line breaking ----------
// CJK text has no word spaces, so it is set character by character with the usual 禁则 (kinsoku) rules:
// closing punctuation may not open a line, opening brackets may not end one.
// what makes a string "CJK": ideographs, kana, CJK punctuation and fullwidth forms. Deliberately narrow —
// · — … “ ” are common in Latin setting too, so they must NOT send a Latin string down the CJK path.
const CJK = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;
// once we are in CJK, those same dashes/quotes do behave as CJK punctuation, so they become their own atoms
const CJK_ATOM = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u00B7\u2014\u2015\u2026\u2018\u2019\u201C\u201D]/;
// 行首禁则: a line may not begin with these (pull them back onto the previous line)
const NO_HEAD = new Set([...'、。，．；：？！）」』】》〉·…—”’']);
// 行尾禁则: a line may not end with these (push them onto the next line)
const NO_TAIL = new Set([...'（「『【《〈“‘']);
// breaking right after one of these is a clause boundary, which is where a Chinese note wants to wrap
const CLAUSE = new Set([...'。，、；：？！．…—,.;:?!']);
const isCJK = s => CJK.test(s);
// Chinese has no word spaces, so the only thing telling us where a word ends is a segmenter.
// Intl.Segmenter ships a Chinese dictionary in the browser; without it we fall back to breaking
// between any two characters, which is the old behaviour.
const SEG = (() => { try { return new Intl.Segmenter('zh', { granularity: 'word' }); } catch { return null; } })();
// split into units: one unit per word, one per CJK punctuation mark, one per run of Latin.
// `sp` remembers that whitespace preceded the unit; `wid` is the word it belongs to (null for punctuation).
function cjkUnits(str) {
  const owner = new Map();   // character offset -> id of the word-like segment that owns it
  if (SEG) { let id = 0; for (const s of SEG.segment(str)) { if (!s.isWordLike) continue; id++; for (let i = s.index; i < s.index + s.segment.length; i++) owner.set(i, id); } }
  const out = []; let buf = '', sp = false, off = 0, bufOff = 0;
  const flush = () => { if (buf) { out.push({ s: buf, sp, wid: owner.get(bufOff) }); buf = ''; sp = false; } };
  for (const ch of str) {
    if (/\s/.test(ch)) { flush(); sp = true; }
    else if (CJK_ATOM.test(ch)) { flush(); out.push({ s: ch, sp, wid: owner.get(off) }); sp = false; }
    else { if (!buf) bufOff = off; buf += ch; }
    off += ch.length;
  }
  flush();
  // glue the characters of one word into a single unit so no break can fall inside it (茉莉, 咖啡豆, …)
  const units = [];
  for (const a of out) { const p = units[units.length - 1]; if (p && a.wid != null && p.wid === a.wid) p.s += a.s; else units.push(a); }
  return units;
}
const joinAtoms = its => its.map((a, i) => (i && a.sp ? ' ' : '') + a.s).join('');
function wrapCJK(ctx, str, maxW, o) {
  // a unit that cannot fit on a line of its own is the only thing we break mid-word
  const atoms = [];
  for (const a of cjkUnits(str)) {
    if (a.s.length > 1 && measure(ctx, a.s, o).tw > maxW) { let first = true; for (const ch of a.s) { atoms.push({ s: ch, sp: first ? a.sp : false }); first = false; } }
    else atoms.push(a);
  }
  const lines = []; let cur = [];
  for (const a of atoms) { if (!cur.length) cur = [a]; else if (measure(ctx, joinAtoms([...cur, a]), o).tw <= maxW) cur.push(a); else { lines.push(cur); cur = [a]; } }
  if (cur.length) lines.push(cur);
  const wid = its => measure(ctx, joinAtoms(its), o).tw;
  // two lines: even them out, exactly as the Latin path does, so a note never ends on a short orphan
  if (lines.length === 2) {
    const all = [...lines[0], ...lines[1]], cands = [];
    for (let k = 1; k < all.length; k++) {
      const wa = wid(all.slice(0, k)), wb = wid(all.slice(k));
      if (wa > maxW || wb > maxW) continue;
      cands.push({ m: Math.max(wa, wb), k, clause: CLAUSE.has(all[k - 1].s.slice(-1)) });
    }
    if (cands.length) {
      const mBest = Math.min(...cands.map(c => c.m)), pool = cands.filter(c => c.m <= mBest + maxW * 0.02);
      const pick = pool.find(c => c.clause) || pool[pool.length - 1];   // prefer a clause break, else the fuller first line
      lines.length = 0; lines.push(all.slice(0, pick.k), all.slice(pick.k));
    }
  }
  // three lines or more: a last line holding one lone unit reads as an orphan — hand it the unit above
  if (lines.length >= 3) {
    const last = lines[lines.length - 1], prev = lines[lines.length - 2];
    if (last.length === 1 && prev.length > 1) last.unshift(prev.pop());
  }
  // 行尾禁则 — an opening bracket never ends a line: hand it to the next one
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (NO_TAIL.has(L[L.length - 1].s) && (L.length > 1 || i < lines.length - 1)) {
      const m = L.pop();
      if (lines[i + 1]) lines[i + 1].unshift({ s: m.s, sp: false }); else lines.push([{ s: m.s, sp: false }]);
    }
  }
  // 行首禁则 — closing punctuation never opens a line: pull it back (the line above is allowed to run a little wide)
  for (let i = 1; i < lines.length; i++) { const L = lines[i], P = lines[i - 1]; while (L.length && NO_HEAD.has(L[0].s)) P.push({ s: L.shift().s, sp: false }); }
  return lines.filter(L => L.length).map(joinAtoms);
}
// wrap a string into lines no wider than maxW at a fixed size (the size never changes; long text gets more lines)
export function wrapLines(ctx, str, maxW, o) {
  const s = String(str || '');
  if (isCJK(s)) return wrapCJK(ctx, s, maxW, o);
  const words = s.split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (!cur || measure(ctx, t, o).tw <= maxW) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  // balance two-line notes so no word is left alone on the second line
  if (lines.length === 2) { let best = null; for (let k = 1; k < words.length; k++) { const a = words.slice(0, k).join(' '), b = words.slice(k).join(' '), wa = measure(ctx, a, o).tw, wb = measure(ctx, b, o).tw; if (wa > maxW || wb > maxW) continue; const m = Math.max(wa, wb); if (!best || m < best.m) best = { m, l: [a, b] }; } if (best) return best.l; }
  return lines;
}
