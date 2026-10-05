import { makeComp, layerSet, setFrame, S, OX, OY } from './comp.js';
import { DUR, T, VO } from './story.js';
import { subtitle } from './subs.js';
import { clamp } from '/core/lib.js';
const q = new URLSearchParams(location.search);
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；版面由 setFrame() 按实际帧重排。
const VW = window.innerWidth, VH = window.innerHeight;
const cv = document.getElementById('c');
cv.width = VW; cv.height = VH;
setFrame(VW, VH);
const comp = makeComp(cv);
const A = layerSet(VW, VH), B = layerSet(VW, VH), TMP = layerSet(VW, VH);
const mode = q.get('test');
await document.fonts.load('600 40px CormorantSC'); await document.fonts.load('500 40px CormorantSC');
await document.fonts.load('italic 500 40px Cormorant'); await document.fonts.load('500 40px Cormorant');
await document.fonts.load('40px MaShanZheng', '水');
const NOSUB = q.has('nosub') || q.has('poster'), POSTER = q.has('poster');

let render;
if (mode) {
  const mod = await import('./test.js');
  window.DUR = 1;
  render = t => mod.render(t, A, B, comp, mode);
} else {
  const SH = await import('./film.js');
  await SH.init(TMP);
  window.DUR = DUR;
  window.EV = SH.events();
  render = t => {
    A.clear(); B.clear();
    const o = SH.frame(t, A, B, TMP) || {};
    // 字幕（题跋）：放在当前镜头的留白处。位置与字号都走设计帧 → 当前帧等比装入（×S + 居中偏移）。
    if (!NOSUB) for (const v of VO) {
      const [a, b] = v.sub; if (t < a || t > b) continue;
      const k = Math.min(clamp((t - a) / .35), clamp((b - t) / .4));
      const pos = SH.subPos(v.id, t);
      subtitle(o.subInB ? B : A, v.text, pos[0] * S + OX, pos[1] * S + OY, k, { size: (pos[2] || 46) * S });
    }
    if (POSTER) {   // 海报：片名题在江面留白处
      const c = A.cd; c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#000'; c.globalAlpha = .9;
      c.font = '600 64px CormorantSC'; c.letterSpacing = '12px'; c.fillText('THE SWORDSMAN', 170, 800); c.fillText('AND THE RIVER', 170, 885);
      c.font = 'italic 500 30px Cormorant'; c.letterSpacing = '3px'; c.globalAlpha = .7; c.fillText('a Chinese ink wash film', 174, 945); c.restore();
      A.cc.setTransform(1, 0, 0, 1, 0, 0); SH.seal(A.cc, 900, 815, 76, .95, 5);
    }
    comp(A, B, o);
  };
}
window.render = render;
window.READY = true;
