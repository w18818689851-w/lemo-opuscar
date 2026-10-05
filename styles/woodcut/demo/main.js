// The Bell Founder — Woodcut Print demo (entry)
import * as ST from './stage.js';
const qs = new URLSearchParams(location.search);
const cv = document.getElementById('cv'), g = cv.getContext('2d');
await document.fonts.load('400 40px "IM Fell English"'); await document.fonts.load('400 40px "IM Fell English SC"'); await document.fonts.load('italic 400 40px "IM Fell English"');
const TEST = qs.get('test');
if (TEST) {
  const m = await import('./test.js');
  await (m.init ? m.init(qs) : null); await (m.preload ? m.preload(qs) : null);
  window.DUR = 1; window.render = t => m.test(g, TEST, t, qs); window.READY = true;
} else {
  // 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
  // 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；版面由 stage.setFrame() 按实际帧重排。
  cv.width = window.innerWidth; cv.height = window.innerHeight;
  ST.setFrame(cv.width, cv.height);
  const m = await import('./film.js');
  await m.init(g, qs);
  window.DUR = m.DUR; window.EV = m.EV; window.SUBS = m.SUBS; window.render = t => m.render(g, t); window.READY = true;
}
