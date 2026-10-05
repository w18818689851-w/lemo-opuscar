import { renderFilm, setLines, subs, buildEvents, DUR } from './film.js';
import * as frames from './frames.js';
const cv = document.getElementById('c'), g = cv.getContext('2d');
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；版面由 renderFilm() 按实际帧重排。
const VW = window.innerWidth, VH = window.innerHeight;
cv.width = VW; cv.height = VH;
await Promise.all([300, 400, 500, 600, 700].flatMap(w => [`${w} 40px Inter`, `${w} 40px InterTight`, `${w} 40px JBMono`]).map(f => document.fonts.load(f)));
const get = async (u, d) => { try { const r = await fetch(u); return r.ok ? await r.json() : d; } catch { return d; } };
const lines = await get('lines.json', []);
setLines(lines, await get('voices/dur.json', null));
window.DUR = DUR;
window.EV = buildEvents();
window.SUBS = subs();
window.ECHO_SUB = { t0: 34.5, t1: 37.0, text: 'Room to think.' };
const Q = new URLSearchParams(location.search);
const scene = Q.get('scene');
window.render = scene ? (t => frames[scene](g, t)) : (t => renderFilm(g, t, { nosub: Q.has('nosub'), W: VW, H: VH }));
window.READY = true;
