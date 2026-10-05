// 帧尺寸不是常量：渲染器截的是浏览器**视口**（`--size/--ratio` 改它），不是 canvas。NATIVE 是设计帧（1920×1080）。
// main.js 在建画布之前按实际视口调 setFrame()，影片的两套坐标各归各的：
//   · 正交相机的 frustum 按「**设计水平范围不变**」重取景：fw 固定 = 设计帧的宽度（竖屏也不裁切水平方向），
//     竖直范围 fhh = fw × H/W 随画幅变 ⇒ 竖屏上下多看到天空与海（世界被等比装入并居中，16:9 时 fhh = fh）；
//   · HUD（片名 / 字幕 / 片尾卡）贴**当前帧**：位置按 FX/FY、尺寸与字号按 S。
// 1920×1080 时 FX = FY = S = 1、fhh = fh，每个表达式退化成它替换掉的那个数字 ⇒ 16:9 逐字节不变。
export const NATIVE = { W: 1920, H: 1080 };
export let W = NATIVE.W, H = NATIVE.H, FX = 1, FY = 1, S = 1;
export function setFrame(w, h) { W = w; H = h; FX = w / NATIVE.W; FY = h / NATIVE.H; S = Math.min(FX, FY); }
// 画幅能力声明（`lib/aspects.mjs` 只探 `demo/film*.js` 的这段**字面量**）：
// 9:16 走「正交相机重取景」——主体完整、不裁切、不变形。
export const FILM_META = { id: 'the-island-that-grew', title: 'The Island That Grew', style: 'Low-poly Isometric Island', aspects: ['16:9', '9:16'] };
