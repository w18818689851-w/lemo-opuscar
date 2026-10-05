// Page contract: window.READY, window.render(t), window.DUR, window.EV
import { textures } from './engine/toon.js';
const Q = new URLSearchParams(location.search);
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 `--size/--ratio` 只会把 1920×1080 的画面裁掉一块；版面由 renderFilm 首行的 setFrame() 按实际帧重排。
const cv = document.getElementById('c'), g = cv.getContext('2d');
cv.width = window.innerWidth; cv.height = window.innerHeight;
await Promise.all(['700 80px Oleo', '400 80px Oleo', '80px Slab', '400 40px Jost', '500 40px Jost', '600 40px Jost', '700 40px Jost'].map(f => document.fonts.load(f)));
textures();
const content = await (await fetch(Q.get('content') || 'content.json')).json();
let durs = {}; if (!Q.get('content') || Q.get('durs')) try { durs = await (await fetch(Q.get('durs') || 'voices/dur.json')).json(); } catch (e) {}
const film = await import('./film.js');
film.setup(content, durs);
window.DUR = film.DUR(); window.EV = film.events(); window.SRT = film.srtCues();
window.render = async t => {
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (Q.get('test') === 'sheet') { (await import('./sheet.js')).drawSheet(g, t, content); return; }
  film.renderFilm(g, t, Q, { W: cv.width, H: cv.height });
};
window.READY = true;
