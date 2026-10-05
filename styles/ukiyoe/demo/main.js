// page contract for core/render: window.READY, window.render(t), window.DUR, window.EV, window.SUBS, window.FILM
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块。改 canvas 尺寸要在影片模块渲染之前，并重设 width/height 属性。
// 版面由 film.js 按实际帧重排（print.js 的 setFrame 写入 FW/FH/FX/FY/S）。
import { buildTextures, setFrame } from './print.js';
const cv = document.getElementById('c');
const VW = window.innerWidth, VH = window.innerHeight;
cv.width = VW; cv.height = VH;
setFrame(VW, VH);
await document.fonts.load('400 40px Yuji', '山へ五景旅一二三四田毎の朝雨橋茶屋窓海立つ');
await document.fonts.load('600 40px ShipporiK', '山へ五景'); await document.fonts.load('500 40px Shippori', 'Aa'); await document.fonts.load('700 40px Shippori', 'Aa');
buildTextures();
const film = await import('./film.js');
window.DUR = film.DUR; window.EV = film.EV; window.SUBS = film.SUBS;
if (film.LINES) window.LINES = film.LINES;
if (film.FILM_META) window.FILM = film.FILM_META;
window.render = t => film.render(t);
const QS = new URLSearchParams(location.search);
film.render(parseFloat(QS.get('t') ?? '20'));
window.READY = true;
