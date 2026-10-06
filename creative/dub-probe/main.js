// 路 B 探针：**不改动 styles/**，直接复用现成风格 swiss-motion 的绘图程序，喂入自定义文案。
//
// 目的：验证「文案出片」走 Canvas2D 真画（路 B）是否成立 —— 即
//   ① 现成风格的 render(t) 能不能承接**任意文案**；
//   ② 换文案需要满足哪些**契约**（这是知识库要沉淀的「编排手法」）。
//
// 引用方式：全部走服务根绝对路径 /styles/...（只读），字体同样引用该风格的 fonts.css。
// 页面契约：暴露 window.render(t) / window.DUR / window.READY（与 core/render/page.mjs 一致）。

import { renderFilm, setScore, setWords, setLines, buildEvents, measureNumeral, DUR }
  from '/styles/swiss-motion/demo/film.js';

const Q = new URLSearchParams(location.search);
const LANG = Q.get('lang') || 'en';

// ── 自定义文案（原片是「五条海报规则」，这里整段替换掉）──────────────────
// 注意：setLines 用 `text.indexOf('. ')` 切「小字导语 / 大字陈述」，
//       所以文案里**必须含 ". "**，否则切分会失败（见 zh 变体）。
const CUSTOM = {
  // 英文：满足契约
  en: [
    { id: 'l1',  t: 4.4,   text: 'Step one. Name the promise.' },
    { id: 'l2',  t: 8.4,   text: 'Step two. Show it working.' },
    { id: 'l3',  t: 12.4,  text: 'Step three. Cut the noise.' },
    { id: 'l4',  t: 16.4,  text: 'Step four. Prove the number.' },
    { id: 'l4b', t: 20.1,  text: 'Clean. And a little cold.' },
    { id: 'l5',  t: 22.15, text: 'Step five. Break one rule.' },
    { id: 'l5b', t: 24.9,  text: 'LEMO' },
    { id: 'l6',  t: 28.0,  text: 'Then make it yours.' },
  ],
  // 中文（原样，用中文句号）：用来暴露「切分契约」与「字体覆盖」两个问题
  zh: [
    { id: 'l1',  t: 4.4,   text: '第一，先给结论。' },
    { id: 'l2',  t: 8.4,   text: '第二，给一个例子。' },
    { id: 'l3',  t: 12.4,  text: '第三，删掉废话。' },
    { id: 'l4',  t: 16.4,  text: '第四，给个数字。' },
    { id: 'l4b', t: 20.1,  text: '干净，也有点冷。' },
    { id: 'l5',  t: 22.15, text: '第五，破一条规矩。' },
    { id: 'l5b', t: 24.9,  text: '留白' },
    { id: 'l6',  t: 28.0,  text: '剩下的交给你。' },
  ],
};

const lines = CUSTOM[LANG] || CUSTOM.en;

// ── 语音时长与逐词时间：本探针不跑 TTS，按字数合成一个可用的近似值 ──────────
// （真实链路里这两份来自 core/tts；这里只要让时间表成立即可）
const dur = {}, words = {};
for (const L of lines) {
  const n = Math.max(1, L.text.length);
  dur[L.id] = +(n * 0.062).toFixed(3);                       // ≈ 16 字/秒
  words[L.id] = Array.from({ length: n + 1 }, (_, i) => +(i * dur[L.id] / n).toFixed(3));
}

const cv = document.getElementById('c'), g = cv.getContext('2d');
await Promise.all(['300', '400', '500', '600', '700', '800', '900']
  .map(w => document.fonts.load(`${w} 40px Archivo`))
  .concat([document.fonts.load('40px Fraktur'), document.fonts.load('40px DMSerif')]));

// 编排手法（海报网格 = 乐谱）沿用该风格自带的 score.json —— 这正是「复用制作思路」
setScore(await (await fetch('/styles/swiss-motion/demo/score.json')).json());
setLines(lines, dur);
setWords(words);
measureNumeral(g);

window.DUR = DUR;
window.EV = buildEvents();
window.SUBS = lines.map(L => ({ t0: L.t, t1: L.t + dur[L.id], text: L.text }));
window.render = t => renderFilm(g, t, { nosub: Q.has('nosub'), poster: Q.has('poster') });
window.READY = true;
