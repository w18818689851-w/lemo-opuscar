// 输出尺寸与宽高比的唯一来源。出片流程（控制台 / lemo-make 编排器）与渲染工具都从这里取，
// 「选一个比例」到「一对偶数像素」的换算只写这一遍。
//
// 为什么尺寸要用视口传达：渲染器截的是浏览器视口，不是 canvas（core/render/video.mjs 用
// page.screenshot()）。所以选比例 = 设视口 = 设输出像素，页面必须让 canvas 跟着视口走
// （见 styles/engraving/demo/main.js），否则 --size 只会把画面裁掉一块。
//
// 注意：这里的默认比例是 9:16，但**低层渲染工具 takeSize 的默认仍是 1920x1080**。
// 理由：still.mjs / video.mjs 是全库 35 个 demo/build.sh（43 个风格里 8 个没带 build.sh）直接调的低层工具，
// 它们都不传 --size、全按 1920x1080 构图；把低层默认改成 9:16 会让这 35 部示例片当场全坏。
// 「默认 9:16」落在出片流程（D:\lemo-tools\lemo-make.mjs 编排器与控制台），那里会显式传尺寸。
// 口径：ls styles/*/demo/build.sh | wc -l = 35；grep -l -- --size styles/*/demo/build.sh 为空（没有一个传尺寸）。

// 预设比例清单：第一条即默认项，所以 9:16 排最前。
export const RATIOS = [
  { id: '9:16', label: '9:16 竖屏（默认）' },
  { id: '16:9', label: '16:9 横屏' },
  { id: '3:4',  label: '3:4 竖版' },
  { id: '4:3',  label: '4:3 横版' },
  { id: '1:1',  label: '1:1 方形' },
];
export const DEFAULT_RATIO = '9:16';

// 低层渲染工具的缺省像素（历史行为，别动）：与 DEFAULT_RATIO 无关。
export const FALLBACK_SIZE = { w: 1920, h: 1080 };

const RATIO_IDS = new Set(RATIOS.map(r => r.id));

// ── 输出尺寸的上下限（**唯一来源**：控制台 / 编排器 / UI / 文档都从这里读，不许各写一份）──
//
// 下限 96 不是编造的，是**实测的几何下限**再留 20% 余量。推导：
//   影片把尺寸按 S = min(W/1920, H/1080) 统一缩放（位置按 fx/fy 拉伸）。圆窗半径 = RR·S，
//   而 engine/plate.js 的 roundelFrame 还要画一条内圈，半径是 `RR·S − max(3.5, RR·S·0.035)`。
//   半径一旦为负，ctx.arc() 就抛 IndexSizeError —— 且**没人接**，整个渲染进程退出码 1。
//   ⇒ 能不能画出来由 `RR·S ≥ 3.5` 决定（RR 是影片自己的圆窗半径）：
//       film_coffee（RR = 84）：S ≥ 3.5/84  = 0.0416667 → W ≥ 80   实测 80 起正常、72 崩
//       film.js    （RR = 120）：S ≥ 3.5/120 = 0.0291667 → W ≥ 56   实测 56 起正常、48 崩
//   取两者的较大值 80，再留 20% 余量 ⇒ **96**（保证 S ≥ 96/1920 = 0.05，比 0.0416667 高 20%）。
//   96 同时是偶数、16 的倍数（H.264 宏块友好）。
//   ⚠️ 这条下限管的是「画出来还有意义」。比它更小的尺寸渲染器已做防御性钳位（plate.js
//      roundelFrame 把半径钳到非负），不会再崩 —— 但画出来只是一堆退化图形，所以这里拒绝。
//   ⚠️ 历史：这里曾是 16，与 takeSize 的旧校验「保持一致」，但 16 从来画不出来（≤72 必崩）。
export const MIN_SIZE = 96, MAX_SIZE = 8192;

const even = n => 2 * Math.round(n / 2);    // 就近取偶数（H.264 yuv420p 要求偶数边长）
const ok = n => Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE;

// 解析尺寸写法：'9:16'（预设比例）或 '1080x1920' / '1080X1920'（自定义像素）。
// 返回 { ratio } 或 { w, h }；语法不对、或比例不在 RATIOS 里，返回 null（不抛，交给调用方决定）。
// 注意：自定义像素这里只做「解析」，偶数/范围校验在 resolveSize 里做。
export function parseSizeSpec(s) {
  const v = String(s ?? '').trim();
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(v);        // 比例
  if (m) { const id = `${+m[1]}:${+m[2]}`; return RATIO_IDS.has(id) ? { ratio: id } : null; }
  const p = /^(\d+)\s*[xX]\s*(\d+)$/.exec(v);     // 自定义像素
  if (p) return { w: +p[1], h: +p[2] };
  return null;
}

// 把「比例 or 自定义尺寸」解析成 { w, h }。返回的尺寸一定满足：偶数、MIN_SIZE–MAX_SIZE。非法输入返回 null。
// 优先级：size（更具体）> ratio > DEFAULT_RATIO。base 是比例模式下的「长边」像素，默认 1920。
//
// 各预设比例在 base=1920 下的推导（长边 = 1920，s = 1920 / max(a, b)）：
//   9:16  a=9  b=16  s=120  → 1080 x 1920   ← 默认
//   16:9  a=16 b=9   s=120  → 1920 x 1080
//   3:4   a=3  b=4   s=480  → 1440 x 1920
//   4:3   a=4  b=3   s=480  → 1920 x 1440
//   1:1   a=1  b=1   s=1920 → 1920 x 1920
export function resolveSize({ ratio, size, base = 1920 } = {}) {
  const fromRatio = id => {
    const [a, b] = id.split(':').map(Number);
    const s = base / Math.max(a, b);
    const w = even(a * s), h = even(b * s);
    return ok(w) && ok(h) ? { w, h } : null;
  };
  const spec = size ?? ratio;                        // size 优先
  if (spec != null && spec !== '') {
    const p = parseSizeSpec(spec);
    if (!p) return null;
    if (p.w != null) return ok(p.w) && p.w % 2 === 0 && ok(p.h) && p.h % 2 === 0 ? { w: p.w, h: p.h } : null;
    return fromRatio(p.ratio);
  }
  return fromRatio(DEFAULT_RATIO);                   // 都不给：用默认比例
}

// 日志用：{ w: 1080, h: 1920 } → '1080x1920'
export function formatSize({ w, h }) { return `${w}x${h}`; }
