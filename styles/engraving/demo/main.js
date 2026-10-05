// page contract for core/render: window.READY, window.render(t), window.DUR, window.EV
// ?content=content_alt.json swaps the content file. ?film=film_coffee picks another film module (default: film.js).
// The content file also picks the language version: its `lang` field selects a record in core/lang/lang.mjs,
// which gives the faces to preload here and the faces the film swaps in (see core/lang/lang.mjs).
import { langOf, fontsToLoad } from '../../../../core/lang/lang.mjs';
const q = new URLSearchParams(location.search);
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const mod = await import('./' + (q.get('film') || 'film') + '.js');
const { makeFilm } = mod;
const C = await (await fetch(q.get('content') || 'content.json')).json();
const L = langOf(C);
let dur = {};
try { const r = await fetch(q.get('voices') || 'voices/dur.json'); if (r.ok) dur = await r.json(); } catch {}
await Promise.all(fontsToLoad(L).map(f => document.fonts.load(f)));
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器视口，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把画面裁掉一块。改 canvas 尺寸要在 makeFilm 之前，并重设 width/height 属性。
const W = window.innerWidth, H = window.innerHeight;
cv.width = W; cv.height = H;
const film = makeFilm(C, dur, { W, H });
window.DUR = film.DUR; window.EV = film.EV; window.T = film.T;
if (mod.LINES) window.LINES = mod.LINES;
if (mod.probeAt) window.PROBE = mod.probeAt;
if (mod.FILM_META) window.FILM = mod.FILM_META;
window.render = t => film.render(ctx, t);
window.READY = true;
