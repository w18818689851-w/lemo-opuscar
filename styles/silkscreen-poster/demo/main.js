import { setup, render } from './film.js';
const Q = new URLSearchParams(location.search);
await Promise.all(['900 40px BigShoulders', '800 40px BigShoulders', '500 40px Outfit', '600 40px Outfit', '700 40px Outfit', '800 40px Outfit'].map(f => document.fonts.load(f)));
const content = await (await fetch(Q.get('content') || 'content.json')).json();
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；版面由 setup() 按实际帧重排。
const VW = window.innerWidth, VH = window.innerHeight;
const cv = document.getElementById('c');
cv.width = VW; cv.height = VH;
const TL = setup(content, cv, { W: VW, H: VH });
window.DUR = TL.dur; window.EV = TL.ev; window.TL = TL.secs.map(s => ({ kind: s.kind, t0: s.t0, t1: s.t1 }));
window.render = t => render(t);
window.READY = true;
