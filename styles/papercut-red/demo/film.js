// 帧尺寸不是常量：渲染器截的是浏览器**视口**，--size/--ratio 会改它。NATIVE 是设计帧（1920×1080）。
// main.js 读视口尺寸后调 setFrame()，版面从帧重推。本风格有两类家什（见 MAINTAINING.md「让影片支持多比例」）：
//   · **设计帧里的东西**（相机里的世界、片名卡、片尾揭示与片尾卡、海报）——走**设计帧 → 当前帧的等比装入**：
//     位置与尺寸都 ×S 再居中（frX/frY/fitM）。相机把 S 折进 zoom（见 main.js 的 cam()），所以世界与家什同一套映射，
//     竖屏下整幅构图等比缩入、**主体不裁、圆不变形**（剪纸的圆不能压成椭圆）。
//   · **当前帧的家什**（字幕横批 / 全屏叠加：淡入淡出 / 揭纸 / 光斑）——位置 ×FX/×FY、尺寸 ×S（ctxX/ctxY），
//     铺满整个视口，不走等比装入（否则竖屏下只覆盖中间一条）。
// 1920×1080 时 FX = FY = S = 1、frX(x) = x、frY(y) = y ⇒ 每个表达式退化成它替换掉的那个数字，16:9 逐字节不变。
// 顶层不许算几何：W/H 只在 setFrame() 里被赋值；模块加载期建的常驻画布走 fcanvas() 注册、由 setFrame() 重设尺寸。
export const NATIVE = { W: 1920, H: 1080 };
export let W = NATIVE.W, H = NATIVE.H, FX = 1, FY = 1, S = 1;
const _canvases = [];
/** 常驻画布（模块加载期建）：注册后由 setFrame() 按当前帧重设尺寸。wr/hr = 相对帧的宽/高比例。
 *  返回 [canvas, ctx2d]（与 paper.js 的 canvas() 同形）。 */
export function fcanvas(wr = 1, hr = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(W * wr)); c.height = Math.max(1, Math.round(H * hr));
  _canvases.push([c, wr, hr]); return [c, c.getContext('2d')];
}
export function setFrame(w, h) {
  W = w; H = h; FX = w / NATIVE.W; FY = h / NATIVE.H; S = Math.min(FX, FY);
  for (const [c, wr, hr] of _canvases) {
    const nw = Math.max(1, Math.round(W * wr)), nh = Math.max(1, Math.round(H * hr));
    if (c.width !== nw || c.height !== nh) { c.width = nw; c.height = nh; }
  }
}
// 设计帧（1920×1080）→ 当前帧的等比装入：位置与尺寸都 ×S，再把设计帧中心 (960,540) 搬到帧中心 (W/2,H/2)。
// 相机里的一切、片名卡、片尾揭示、片尾卡、海报都读它；1920×1080 时 S = 1 ⇒ frX(x) = x、frY(y) = y。
export const frX = x => W / 2 + (x - 960) * S;
export const frY = y => H / 2 + (y - 540) * S;
// 世界 = 设计帧（相机把 S 折进 zoom 后，世界在设计屏坐标里的位置正好也走 frX/frY），保留旧名给 fold.js。
export const wdX = frX, wdY = frY;
// 把「设计帧里的一条仿射矩阵」搬进当前帧：线性部分（旋转/缩放）×S，平移部分走 frX/frY。
export const fitM = M => [M[0] * S, M[1] * S, M[2] * S, M[3] * S, frX(M[4]), frY(M[5])];
// 当前帧的家什（字幕 / 全屏叠加）：位置 ×FX/×FY（尺寸另由调用方 ×S）。
export const ctxX = x => x * FX, ctxY = y => y * FY;

// FILM_META.aspects —— 这部影片**真的能正确构图**的输出比例清单（**字面量**：控制台按源码文本探测，
// 不是求值，见 D:\lemo-tools\lib\aspects.mjs）。不写 = 只支持 16:9（= 没改造过，按 1920×1080 绝对像素
// 构图、给别的尺寸会被裁）。这里能列 9:16，是因为 main.js 从视口经 setFrame() 重排了相机与当前帧家什。
export const FILM_META = { id: 'nian-comes-to-town', title: 'Nian Comes to Town', style: 'Red Paper-cut', aspects: ['16:9', '9:16'] };
