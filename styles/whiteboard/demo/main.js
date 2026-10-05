import * as W from './engine/wb.js';
const q = new URLSearchParams(location.search);
const mod = await import(q.get('scene') === 'test' ? './test.js' : './film.js');
await document.fonts.load('44px AD');
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；版面由 setFrame() 按实际帧重排。
const VW = window.innerWidth, VH = window.innerHeight;
const cv = document.getElementById('c');
cv.width = VW; cv.height = VH;
W.setFrame(VW, VH);
const F = await mod.build();
const ctx = cv.getContext('2d');
window.DUR = F.dur; window.EV = [...F.ev, { t: 0, type: 'cues', ...F.cues }]; window.SUBS = F.subs || [];
window.render = t => F.render(ctx, t);
window.READY = true;
