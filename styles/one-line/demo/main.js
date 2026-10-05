// 页面契约：读视口尺寸 → 设 canvas → 载字体 → 建影片 → 暴露 window.render / DUR / EV / SUBS / READY。
// 影片本体在 film.js（含 FILM_META.aspects 声明与 makeFilm）。?nosub / ?poster / ?clean / ?all 等见 film.js。
import { makeFilm } from './film.js';

const cv = document.getElementById('c'), ctx = cv.getContext('2d');
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；版面由 makeFilm 按实际帧重排（frame.setFrame）。
const W = window.innerWidth, H = window.innerHeight;
cv.width = W; cv.height = H;
await document.fonts.load('500 40px Caveat'); await document.fonts.load('600 40px Caveat'); await document.fonts.load('80px Sacramento');

const film = makeFilm({ W, H });
window.PATH = film.path;
window.DUR = film.DUR;
window.EV = film.EV;
window.SUBS = film.SUBS;
window.render = t => film.render(ctx, t);
window.READY = true;
