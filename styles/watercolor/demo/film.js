// Follow the Rain —— 水彩影片模块：多比例声明 + 帧派生（设计帧 → 当前帧等比装入）
//
// 设计帧 NATIVE = W×H = 1920×1080（engine.js 的常量，整片构图就按它画）。实际输出帧 FW×FH 由 main.js
// 读**视口**后经 setFrame() 钉进来 —— 渲染器截的是浏览器**视口**，不是 canvas。
// 世界内容（风景 / 地图 / HUD / 字幕 / 片头片尾）都画在设计帧坐标里，再由 render() 施加
// 「设计帧 → 当前帧等比装入」（中心对齐、紧轴缩放 S，见 fit()）：竖屏**不裁切、不变形**，主体完整，
// 多出来的上下两条补纸色 + 纸纹 —— 水彩本来就在纸边收白（scene.js 地面底边、天空顶端都渐隐到纸），
// 留白即纸，读起来是「同一张画裱进更高的纸框」。
// 1920×1080 时 FX = FY = S = 1、偏移 0 ⇒ fit() 退化成 ctx.setTransform() ⇒ 16:9 逐字节不变。
const NATIVE = { W, H };                                   // W / H 来自 engine.js（本文件在其后加载）
let FW = NATIVE.W, FH = NATIVE.H, FX = 1, FY = 1, S = 1, OX = 0, OY = 0;
function setFrame(w, h) {
  FW = w; FH = h; FX = w / NATIVE.W; FY = h / NATIVE.H; S = Math.min(FX, FY);
  OX = (FW - NATIVE.W * S) / 2; OY = (FH - NATIVE.H * S) / 2;
}
// 把「设计帧坐标里的局部变换」折进等比装入：device = 装入 ∘ local。
// 1920×1080 时 S = 1、偏移 0 ⇒ 等于 ctx.setTransform(a, b, c, d, e, f)。
function fit(a, b, c, d, e, f) { ctx.setTransform(S * a, S * b, S * c, S * d, OX + S * e, OY + S * f); }

// FILM_META.aspects —— 这部影片**真的能正确构图**的输出比例清单（**字面量**：控制台按源码文本探测，
// 不是求值，见 D:\lemo-tools\lib\aspects.mjs）。不写 = 只支持 16:9（= 没改造过，按 1920×1080
// 绝对像素构图、给别的尺寸会被裁）。这里列出 16:9 与 9:16：内容经等比装入重排，竖屏不裁切。
const FILM_META = { id: 'follow-the-rain', title: 'Follow the Rain', style: 'Watercolor Brush', aspects: ['16:9', '9:16'] };
