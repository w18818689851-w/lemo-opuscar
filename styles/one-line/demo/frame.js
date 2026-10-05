// 输出帧尺寸（= 渲染器视口尺寸）——版面几何的**唯一来源**。
// NATIVE 是设计帧（1920×1080，本片构图就是按它画的）；makeFilm 首行调 setFrame 把实际帧钉进来。
//   FX/FY  把设计帧的横 / 纵坐标拉伸到当前帧（位置按轴走）；
//   S = min(FX, FY) 是紧轴 —— 尺寸（字号、线宽、内边距、光晕宽度）一律乘 S。
// 1920×1080 时 FX = FY = S = 1，每个表达式都退化成它替换掉的那个数字 ⇒ 16:9 逐字节不变。
// ★ 相机把 S 折进 zoom（cam.js 的 k = BASE·z·S），所以**世界坐标不再重复乘 FX/FY**。
export const NATIVE = { W: 1920, H: 1080 };
export let W = NATIVE.W, H = NATIVE.H, FX = 1, FY = 1, S = 1;
export function setFrame(w, h) { W = w; H = h; FX = w / NATIVE.W; FY = h / NATIVE.H; S = Math.min(FX, FY); return { W, H, FX, FY, S }; }
