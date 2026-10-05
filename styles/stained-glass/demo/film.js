// 帧尺寸不是常量：渲染器截的是浏览器**视口**，--size/--ratio 会改它。NATIVE 是设计帧（1920×1080）。
// main.js 读视口尺寸后调 setFrame()，版面从帧重推：相机矩阵与透视投影把设计帧中心 (960,540) 换成 (W/2,H/2)，
// 世界按**原比例**居中（不拉伸、不重复乘 FX/FY —— 相机 zoom 里不含 S），竖屏下自然看到更宽的纵向视野；
// 屏幕空间的家什（字幕横幅）位置 ×FX/×FY、尺寸 ×S。1920×1080 时 FX = FY = S = 1、W/2 = 960、H/2 = 540
// ⇒ 每个表达式退化成它替换掉的那个数字，16:9 逐字节不变。
// 顶层不许算几何：W/H 只在 setFrame() 里被赋值。
export const NATIVE = { W: 1920, H: 1080 };
export let W = NATIVE.W, H = NATIVE.H, FX = 1, FY = 1, S = 1;
export function setFrame(w, h) { W = w; H = h; FX = w / NATIVE.W; FY = h / NATIVE.H; S = Math.min(FX, FY); }

// FILM_META.aspects —— 这部影片**真的能正确构图**的输出比例清单（**字面量**：控制台按源码文本探测，
// 不是求值，见 D:\lemo-tools\lib\aspects.mjs）。不写 = 只支持 16:9（= 没改造过，按 1920×1080 绝对像素
// 构图、给别的尺寸会被裁）。这里能列 9:16，是因为 main.js 从视口经 setFrame() 重排了相机与字幕。
export const FILM_META = { id: 'dragon-east-window', title: 'The Dragon of the East Window', style: 'Stained Glass', aspects: ['16:9', '9:16'] };
