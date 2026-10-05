// 帧尺寸不是常量：渲染器截的是浏览器**视口**（`--size/--ratio` 改它），不是 canvas。NATIVE 是设计帧（1920×1080）。
//
// glass-product 是 three.js 影棚片：画面本体（影棚 / 灯条 / 物件 / 地板焦散）与 HUD（片名 / 磨砂玻璃字幕条 /
// 片尾卡）**都按设计帧 1920×1080 构图**，且含多帧全屏覆盖（开场淡入、片尾淡黑）。所以多比例走
// 「**设计帧整体等比装入当前帧 + 同色留白**」这一档：整张设计帧按 S = min(FX, FY) 缩放、居中，
// 设计帧外留背景色 #000——无限黑影棚，留白与画面同色，**看不出黑边**；不裁切、不变形、主体与字幕完整。
// （相机重取景那一档对本风格要动地板 Reflector / 背景 sweep / 焦散屏幕采样，收益只是把本就不可见的黑边
//   换成更多影棚地面，故本轮不走。）
//
// 1920×1080 时 S = 1、偏移 0 ⇒ 调用方不套变换，逐字节等于改造前。
export const NATIVE = { W: 1920, H: 1080 };
export let W = NATIVE.W, H = NATIVE.H, FX = 1, FY = 1, S = 1;
export function setFrame(w, h) { W = w; H = h; FX = w / NATIVE.W; FY = h / NATIVE.H; S = Math.min(FX, FY); }
// 画幅能力声明（`lib/aspects.mjs` 只探 `demo/film*.js` 的这段**字面量**）：9:16 = 设计帧等比装入 + 同色留白。
export const FILM_META = { id: 'aura-hear-the-light', title: 'Aura — Hear the Light', style: 'Glass Product Render', aspects: ['16:9', '9:16'] };
