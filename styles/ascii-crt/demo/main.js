// 页面契约：读视口尺寸 → 设输出画布 → 钉住帧（frame.setFrame）→ 载入影片模块 film.js。
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；版面由 film.js 按实际帧重排。
import { setFrame } from './frame.js';

const out = document.getElementById('c');
const VW = window.innerWidth, VH = window.innerHeight;
out.width = VW; out.height = VH;      // 必须在 film.js 建 CRT（读画布尺寸）之前设好
setFrame(VW, VH);
await import('./film.js');
