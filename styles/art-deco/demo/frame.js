// 帧状态 —— 渲染器截的是浏览器**视口**（`page.screenshot()`），`--size/--ratio` 改的是视口；
// main.js 先把 canvas 设成视口尺寸，再调 setFrame()。
//
// NATIVE = 设计帧（1920×1080）——本片**全部绘制代码的坐标系**（布景、相机、金线、卡片都按它写）。
// W/H = 当前帧；FX/FY = 位置按轴拉伸（×FX/×FY）、S = 尺寸/字号/线宽按紧轴缩放（min(fx,fy)）。
//
// ★ 本片的「版面」是什么：**满幅 16:9 画面，没有画框/片门**（对比 silent-film 的 4:3 片门）。
//   布景是真一点/两点透视的房间（`engine/cam.js` 的针孔相机、`shots_kitchen.js` 与 `scenes/stairs.js`
//   各自的像素级投影器），原生视场下**已经竖直填满画面**（中景以上没有可露出的几何）。所以 9:16 的正解
//   不是「重排」，而是**整幅等比装入 + 同色留白**：把整幅设计画面按紧轴 S 缩小、居中，四外是影院自身的黑。
//   这样 **中轴对称**（`STYLE.md:45`「中轴是构图里唯一不能动的东西」）**逐像素保留**，不裁不变形。
//   留白（底 + 暗角）与字幕是**当前帧的家什**，按 ×FX/×FY、×S 铺满当前帧（见 film.js 的 renderFilm/drawSubs）。
//
// 1920×1080 时 FX=FY=S=1 ⇒ 变换退化成恒等、每个表达式退化成它替换掉的那个数字，16:9 逐字节不变。
export const NATIVE = { W: 1920, H: 1080 };
export let W = NATIVE.W, H = NATIVE.H, FX = 1, FY = 1, S = 1;
export function setFrame(w, h) {
  W = w; H = h; FX = w / NATIVE.W; FY = h / NATIVE.H; S = Math.min(FX, FY);
}
// 设计帧像素 (u,v) → 当前帧的**家什**坐标（位置按轴拉伸、尺寸 ×S）。
export const dX = u => u * FX, dY = v => v * FY;
// 设计帧像素 (u,v) → 当前帧的**画面**坐标（整幅按紧轴等比装入、以设计帧中心为锚）。S=1 时即恒等。
export const pX = u => (u - 960) * S + W / 2, pY = v => (v - 540) * S + H / 2;
