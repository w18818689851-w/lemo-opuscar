// 入口：?test=swatch|model 进入试画页；否则渲染正片
import { makeComp } from './gl.js';
import { BOIL, setFrame } from './crayon.js';
const Q = new URLSearchParams(location.search);
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；版面由 film.frame() 按实际帧重排。
const VW = window.innerWidth, VH = window.innerHeight;
const cv = document.getElementById('gl'); cv.width = VW; cv.height = VH;
setFrame(VW, VH);
const comp = makeComp(cv, VW, VH);
window.DUR = 1;
const fontsToLoad = ['400 40px "Patrick Hand"', '700 40px Gaegu', '400 40px Gaegu', '400 40px "Short Stack"', '400 40px "Gochi Hand"', '400 40px "Caveat Brush"', '400 40px Sniglet'];
await Promise.all(fontsToLoad.map(f => document.fonts.load(f)));
const test = Q.get('test');
if (test) {
  const T = await import('./test.js');
  window.render = t => { BOIL.step = Math.floor(t * 12); T.test(comp, t, test, Q); };
} else {
  const M = await import('./film.js');
  window.DUR = M.DUR; window.EV = M.EV; window.SUBS = M.SUBS;
  window.render = t => { BOIL.step = Math.floor(t * 12 + 1e-6); M.frame(comp, t, VW, VH); };
}
window.READY = true;
