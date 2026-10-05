// Page contract: window.READY, window.render(t), window.DUR, window.EV
// 影片本体在 film.js（本文件只管页面：把 canvas 与**视口**对齐、预载字体、把影片模块接到 window.*）。
import { init, setFrame } from './toon.js';
const Q = new URLSearchParams(location.search);
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 `--size/--ratio` 只会把 1920×1080 的画面裁掉一块；版面由 setFrame() + film.js 按实际帧重排。
const VW = window.innerWidth, VH = window.innerHeight;
const cv = document.getElementById('c');
cv.width = VW; cv.height = VH;
init(cv);
setFrame(VW, VH);
for (const f of ['800 50px "Baloo 2"', '400 60px "Titan One"', '400 60px Bungee', '400 40px VT323']) await document.fonts.load(f);
const film = await import('./film.js');
window.DUR = film.DUR; window.EV = film.EV; window.SUBS = film.SUBS;
if (film.LINES) window.LINES = film.LINES;
if (film.FILM_META) window.FILM = film.FILM_META;
window.render = t => film.render(t);
window.READY = true;
