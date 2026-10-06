// 钩子实验台（A/B/C/D 四格）—— 只读 styles/，钩子跑在副本 film-hooked.js 上。
//
//   hook=0 copy=0  A 原件，未设 window.__COPY__          → 基线
//   hook=1 copy=0  B 副本，未设 window.__COPY__          → 期望与 A 逐字节相同
//   hook=0 copy=1  C 原件，设了 window.__COPY__          → 期望与 A 相同（原件不读该全局）
//   hook=1 copy=1  D 副本，设了 window.__COPY__          → 期望与 A 不同（海报文字被换掉）
//
// 全部使用该风格**自带的** lines.json / dur.json / words_rel.json / score.json，不换文案，
// 目的是把「海报文字钩子」这一项单独隔离出来观察。

import { PAYLOAD } from '../_tx_payload.js';

const Q = new URLSearchParams(location.search);
const HOOK = Q.get('hook') === '1', COPY = Q.get('copy') === '1';

if (COPY) window.__COPY__ = PAYLOAD;      // 必须在 import 电影模块之前设好

const F = await (HOOK
  ? import('/creative/dub-probe/film-hooked.js')
  : import('/styles/swiss-motion/demo/film.js'));

const { renderFilm, setScore, setWords, setLines, buildEvents, measureNumeral, DUR } = F;
const cv = document.getElementById('c'), g = cv.getContext('2d');

await Promise.all(['300', '400', '500', '600', '700', '800', '900']
  .map(w => document.fonts.load(`${w} 40px Archivo`))
  .concat([document.fonts.load('40px Fraktur'), document.fonts.load('40px DMSerif')]));

setScore(await (await fetch('/styles/swiss-motion/demo/score.json')).json());
setLines(await (await fetch('/styles/swiss-motion/demo/lines.json')).json(),
         await (await fetch('/styles/swiss-motion/demo/voices/dur.json')).json());
setWords(await (await fetch('/styles/swiss-motion/demo/voices/words_rel.json')).json());
measureNumeral(g);

window.DUR = DUR;
window.EV = buildEvents();
window.render = t => renderFilm(g, t, {});
window.READY = true;
