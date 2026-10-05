import { Iso, PAL } from './engine.js';
const Q = new URLSearchParams(location.search);
const cv = document.getElementById('c'), g = cv.getContext('2d');
// 渲染器截的是浏览器**视口**（page.screenshot），`--size WxH` / `--ratio` 只改视口。
// 所以 canvas 必须跟着视口走（否则改尺寸只会把 16:9 画面裁掉一块）；film.render() 首行按
// g.canvas.width/height 调 setFrame() 重排版面。
cv.width = window.innerWidth; cv.height = window.innerHeight;
for (const w of [300, 400, 500, 600, 700]) await document.fonts.load(`${w} 40px Jost`);
const film = await import('./film.js');
window.DUR = film.DUR; window.EV = film.events();
window.render = async t => {
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (Q.has('test')) { const m = await import('./tests.js'); m[Q.get('test')](g, t, Q); return; }
  film.render(g, t, Q);
};
window.READY = true;
