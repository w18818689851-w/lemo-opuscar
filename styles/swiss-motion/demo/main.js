import { renderFilm, setScore, setWords, setLines, subs, buildEvents, measureNumeral, DUR } from './film.js';
const cv = document.getElementById('c'), g = cv.getContext('2d');
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器视口，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把画面裁掉一块。改 canvas 尺寸要在 render 之前，并重设 width/height 属性。
const VW = window.innerWidth, VH = window.innerHeight;
cv.width = VW; cv.height = VH;
await Promise.all(['300', '400', '500', '600', '700', '800', '900'].map(w => document.fonts.load(`${w} 40px Archivo`)).concat([document.fonts.load('40px Fraktur'), document.fonts.load('40px DMSerif')]));
setScore(await (await fetch('score.json')).json());
const lines = await (await fetch('lines.json')).json();
const dur = await (await fetch('voices/dur.json')).json();
setLines(lines, dur);
setWords(await (await fetch('voices/words_rel.json')).json());
measureNumeral(g);
window.DUR = DUR;
window.EV = buildEvents();
window.SUBS = subs();
const Q = new URLSearchParams(location.search);
window.render = t => renderFilm(g, t, { nosub: Q.has('nosub'), poster: Q.has('poster'), W: VW, H: VH });
window.READY = true;
