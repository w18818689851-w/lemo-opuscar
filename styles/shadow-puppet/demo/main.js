// Page contract: window.READY, window.render(t), window.DUR, window.EV, window.T, window.SUBS
// 影片本体在 film.js（本文件只管页面：把 gl 画布与**视口**对齐、预载字体、把影片模块接到 window.*）。
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）：gl 画布必须跟着视口走，
// 否则 `--size/--ratio` 只会把 1920×1080 的画面裁掉一块；版面由 film.js → gl.js 的等比装入重排。
import { render, DUR, EV, SUBS, T, FILM_META } from './film.js';
const qs = new URLSearchParams(location.search);
window.DUR = DUR; window.EV = EV; window.T = T; window.SUBS = SUBS;
window.FILM = FILM_META;
window.render = render;
render(parseFloat(qs.get('t') ?? '15'));
window.READY = true;
