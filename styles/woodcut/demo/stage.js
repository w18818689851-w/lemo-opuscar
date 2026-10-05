// The Bell Founder · stage: plate framing, camera, print pass, captions
import * as WC from './engine/index.js';
import { PW, PH } from './world.js';

// 帧尺寸不是常量：渲染器截的是浏览器**视口**，`--size/--ratio` 会改它。main.js 先把 canvas 设成视口尺寸再 init。
// NATIVE = 设计帧（1920×1080）。W/H = 当前帧；FX/FY = 位置按轴拉伸（×FX/×FY）、S = 尺寸/字号/线宽按紧轴缩放。
// 本片是「一张印张」：IMG = 印刷图文区（四边纸白 + 底边字幕栏），随帧按轴拉伸铺满画面；
// 相机在木刻版（PW×PH）上取景，zoom ×S 让整版按紧轴等比缩小、仍居中 ⇒ 9:16 看到的是**整幅版画**
// 居中 + 上下多出的版外留黑（木刻的「未刻之墨」，与画面顶部的夜空 / 底部的深色前景同色，接得上）。
// 与 dataviz 的 9:16（整张纸按紧轴缩小、上下留白）同一条路：位置按轴拉伸、尺寸/字号 ×S。
// 1920×1080 时 FX=FY=S=1、IMG={36,36,1848,912}，每个表达式退化成它替换掉的那个数字 ⇒ 16:9 逐字节不变。
export const NATIVE = { W: 1920, H: 1080 };
export let W = NATIVE.W, H = NATIVE.H, FX = 1, FY = 1, S = 1;
export const IMG = { x: 36, y: 36, w: 1848, h: 912 };      // printed image area; captions live in the bottom margin
export const [M, m] = WC.canvas(W, H);                     // carve mask
export const [C, c] = WC.canvas(W, H);                     // colour plate (alpha)
let P = null;
export function printer() { return P || (P = WC.makePrinter(W, H)); }
// 按当前帧重排版面：W/H 定死，IMG 按轴派生，掩膜/彩版画布与打印机跟着帧走。只在 main.js 里调一次（帧尺寸 = 视口）。
// IMG 是**可变字段**（不是换对象）：shots.js / shots2.js 在加载期 `const { IMG } = ST` 解构了它。
export function setFrame(w, h) {
  W = w; H = h; FX = w / NATIVE.W; FY = h / NATIVE.H; S = Math.min(FX, FY);
  IMG.x = 36 * FX; IMG.y = 36 * FY; IMG.w = 1848 * FX; IMG.h = 912 * FY;
  for (const cv of [M, C]) if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  P = null;                                                // 打印机尺寸随帧重建
}

// camera: centre (x,y) in plate coords, zoom z, roll r
export function camMatrix(cam, full = false) {
  const z = (cam.z ?? 1) * S, r = cam.r ?? 0, cs = Math.cos(r) * z, sn = Math.sin(r) * z;
  const ox = full ? W / 2 : IMG.x + IMG.w / 2, oy = full ? H / 2 : IMG.y + IMG.h / 2;
  const x = cam.x ?? PW / 2, y = cam.y ?? PH / 2;
  return [cs, sn, -sn, cs, ox - (cs * x - sn * y), oy - (sn * x + cs * y)];
}
// start a frame: paper everywhere, then clip to the image area with the camera applied.
// full = true → full-bleed (the wood block world, no paper margin)
export function begin(cam = {}, { full = false, mirror = false } = {}) {
  m.setTransform(1, 0, 0, 1, 0, 0); c.setTransform(1, 0, 0, 1, 0, 0);
  m.fillStyle = '#fff'; m.fillRect(0, 0, W, H); c.clearRect(0, 0, W, H);
  for (const g of [m, c]) {
    g.save();
    if (!full) { g.beginPath(); g.rect(IMG.x, IMG.y, IMG.w, IMG.h); g.clip(); }
    if (mirror) g.setTransform(-1, 0, 0, 1, W, 0);
    const k = camMatrix(cam, full); g.transform(...k);
  }
  if (!full) { m.fillStyle = '#000'; m.fillRect(-4000, -4000, 12000, 12000); }
}
export function end() { m.restore(); c.restore(); m.setTransform(1, 0, 0, 1, 0, 0); c.setTransform(1, 0, 0, 1, 0, 0); }

// caption in the bottom margin (letterpress): drawn in ink on the mask so it gets printed too.
// 字幕是**当前帧**的家什：位置随 IMG（底边字幕栏）走，字号 ×S（否则 9:16 上一行字比画面还宽）。
export function caption(text, a = 1) {
  if (!text || a <= 0) return;
  m.save(); m.setTransform(1, 0, 0, 1, 0, 0);
  m.font = `400 ${44 * S}px "IM Fell English"`; m.textAlign = 'center'; m.textBaseline = 'middle';
  m.fillStyle = `rgba(0,0,0,${a})`;
  m.fillText(text, W / 2, IMG.y + IMG.h + (H - IMG.y - IMG.h) / 2 + 2);
  m.restore();
}
export function print(g, o = {}) {
  const out = printer().render(M, C, o);
  g.drawImage(out, 0, 0);
  return out;
}
