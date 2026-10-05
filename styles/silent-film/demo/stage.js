// Frame pipeline: scene → 4:3 film canvas → FilmPost (tone + ageing) → damage overlay → gate on the 16:9 frame.
import { FilmPost, damage } from './engine/film.js';
import { theatre } from './engine/cards.js';
import { setFrame as setInkFrame } from './engine/ink.js';

// ★ 帧尺寸不是常量：渲染器截的是浏览器**视口**，`--size/--ratio` 会改它。main.js 先把 canvas 设成视口尺寸，再调 setFrame()。
// NATIVE = 设计帧（1920×1080）。W/H = 当前帧；FX/FY = 位置按轴拉伸（×FX/×FY）、S = 尺寸/线宽按紧轴缩放。
// 本片是一台**放映机**：影院（黑场 + 两侧天鹅绒幕布）是当前帧的家什，随帧铺满整帧；
// **4:3 片门是风格特征**，按紧轴等比装入、居中——不拉伸（一拉伸就不是 4:3 了）、也不裁切。
// 片门里放的是 1440×1080 的影片画布（世界）：镜头/字幕卡/虹膜都在这个世界里画，合成时整幅按 S 缩放进片门。
// 1920×1080 时 FX=FY=S=1、GATE={240,0,1440,1080} ⇒ 每个表达式退化成它替换掉的那个数字，16:9 逐字节不变。
// 9:16 时 S=FX=0.5625 ⇒ 片门 810×607.5 居中，上下多出影院的黑（与片门外的黑同色，接得上）。
// ★ 命名：engine/ink.js 已有一个 setFrame(t, opts)（每帧的墨线状态）。这里按库侧惯例把**舞台**的帧设置器
//   叫 setFrame(w,h)，把 ink 那个在本地改名 setInkFrame —— 见 MAINTAINING「让影片支持多比例」的坑 (i)。
export const NATIVE = { W: 1920, H: 1080 };
export let W = NATIVE.W, H = NATIVE.H, FX = 1, FY = 1, S = 1;
export const FW = 1440, FH = 1080;                        // 影片画布（世界）—— 永远 4:3，不随帧变
export const GATE = { x: 240, y: 0, w: 1440, h: 1080 };   // 4:3 片门；**可变字段**（只改字段、不换对象）
export const fc = document.createElement('canvas'); fc.width = FW; fc.height = FH;
export const fg = fc.getContext('2d');
export const post = new FilmPost(FW, FH);
const outc = document.createElement('canvas'); outc.width = FW; outc.height = FH; const og = outc.getContext('2d');

// 按当前帧重排舞台：影院铺满整帧，4:3 片门按紧轴等比装入并居中。只在 main.js 里调一次（帧尺寸 = 视口）。
export function setFrame(w, h) {
  W = w; H = h; FX = w / NATIVE.W; FY = h / NATIVE.H; S = Math.min(FX, FY);
  GATE.w = FW * S; GATE.h = FH * S;
  GATE.x = (W - GATE.w) / 2; GATE.y = (H - GATE.h) / 2;
}

// shoot: draw(fg) the scene, then develop it. fp = film params. returns the developed 4:3 canvas
export function shoot(draw, fp = {}, t = 0) {
  fg.setTransform(1, 0, 0, 1, 0, 0); fg.globalAlpha = 1; fg.globalCompositeOperation = 'source-over';
  fg.fillStyle = '#fff'; fg.fillRect(0, 0, FW, FH);
  setInkFrame(t, { boil: fp.boil ?? 1 });
  draw(fg);
  const dev = post.render(fc, fp, fp.colorMask || null);
  og.setTransform(1, 0, 0, 1, 0, 0); og.drawImage(dev, 0, 0);
  if ((fp.strength ?? .6) > 0.01) damage(og, 0, 0, FW, FH, fp.frame ?? 0, fp.strength ?? .6, fp);
  return outc;
}
// place the developed frame in the gate with the dark theatre around
export function gate(g, dev, spill = post.mean, curtain = 1) {
  theatre(g, W, H, GATE, spill, curtain);
  g.save();
  const r = 22 * S; g.beginPath(); g.roundRect(GATE.x, GATE.y, GATE.w, GATE.h, r); g.clip();
  g.drawImage(dev, GATE.x, GATE.y, GATE.w, GATE.h);
  // aperture edge: soft dark rim (the gate mask is slightly out of focus)
  const e = g.createLinearGradient(GATE.x, 0, GATE.x + 18 * S, 0); e.addColorStop(0, 'rgba(0,0,0,.85)'); e.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = e; g.fillRect(GATE.x, GATE.y, 18 * S, GATE.h);
  const e2 = g.createLinearGradient(GATE.x + GATE.w, 0, GATE.x + GATE.w - 18 * S, 0); e2.addColorStop(0, 'rgba(0,0,0,.85)'); e2.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = e2; g.fillRect(GATE.x + GATE.w - 18 * S, GATE.y, 18 * S, GATE.h);
  g.restore();
}
