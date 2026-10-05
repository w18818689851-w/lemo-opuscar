// 输出帧尺寸（= 渲染器视口尺寸）——「设计帧 → 当前帧等比装入」的唯一来源。
// NATIVE 是设计帧（1920×1080，整片构图就是按它画的，term.js 的 W/H）；main.js 读视口后调 setFrame 钉进来。
//   S  = min(VW/NATIVE.W, VH/NATIVE.H) 紧轴缩放；
//   OX/OY = 居中偏移（把设计帧等比装入当前帧后两侧/上下的留边）。
// 场景内容一律画在设计帧坐标里，begin() 施加 setTransform(S,0,0,S,OX,OY) 把它装入当前帧；
// 全屏叠加（CRT post）读画布尺寸铺满当前帧。1920×1080 时 S = 1、偏移 0 ⇒ 逐字节退化成设计帧。
export const NATIVE = { W: 1920, H: 1080 };
export let VW = NATIVE.W, VH = NATIVE.H, S = 1, OX = 0, OY = 0;
export function setFrame(w, h) { VW = w; VH = h; S = Math.min(w / NATIVE.W, h / NATIVE.H); OX = (w - NATIVE.W * S) / 2; OY = (h - NATIVE.H * S) / 2; return { VW, VH, S, OX, OY }; }
