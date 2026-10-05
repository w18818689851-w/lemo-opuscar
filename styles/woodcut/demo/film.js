// The Bell Founder — film assembly: timeline, shots, transitions, captions, events
import * as WC from './engine/index.js';
import * as ST from './stage.js';
import { W, H } from './stage.js';       // 当前帧尺寸（stage.setFrame() 定的活绑定；1920×1080 时即设计帧）
import { clamp, lerp, seg, ss, eio, eo, ei } from '/core/lib.js';
import { buildWorld, drawValley, snowAt, PW, PH, HOR } from './world.js';
import { curl, peelState } from './trans.js';
import { SHOTS, setup as setupShots } from './shots.js';

// 影片元数据：aspects 是**字面量**（lib/aspects.mjs 按文本正则探测，不写 = 只支持 16:9）。
// 已适配多比例：版面从视口（stage.setFrame() 的 w/h）重排 —— 见 main.js 的 setFrame 与 stage.js 的 IMG。
export const FILM_META = {
  id: 'the-bell-founder',
  title: 'The Bell Founder',
  style: 'Woodcut Print',
  aspects: ['16:9', '9:16'],
};

export let DUR = 58.5, EV = [], SUBS = [];
let TL, K, DURS = {};
export const ctx = { K: null, T: null, table: null, printer: null, bufs: [] };

export async function init(g, qs) {
  TL = await (await fetch('timeline.json')).json(); K = TL.keys; DUR = TL.dur;
  try { const r = await fetch('voices/dur.json'); if (r.ok) DURS = await r.json(); } catch (e) { }
  const im = new Image(); im.src = '/core/assets/polyhaven/walnut_diff.jpg'; await im.decode();
  ctx.table = im; ctx.K = K; ctx.T = TL; ctx.printer = ST.printer();
  for (let i = 0; i < 4; i++) ctx.bufs.push(WC.canvas(W, H));
  // narration + captions
  const VO = [['L1', 'That winter, the snow closed every road, and the tower had no bell.'], ['L2', 'So every house gave what metal it had.'],
    ['L3', 'The boy gave his compass, the one thing that always guided him home.'], ['L4', 'When it rang, the snow stopped to listen.']];
  SUBS = VO.map(([id, text]) => { const t0 = K[id], d = DURS[id] || 3; return { id, t0: t0 - .05, t1: t0 + Math.max(1.8, d + .6), text }; });
  EV = [];
  for (const [id] of VO) EV.push({ t: K[id], type: 'vo', id });
  await setupShots(ctx);
  for (const s of SHOTS) if (s.events) EV.push(...s.events(K));
  EV.sort((a, b) => a.t - b.t);
  window.SUBS = SUBS;
}

export function captionAt(t) {
  for (const s of SUBS) if (t >= s.t0 && t < s.t1) return { text: s.text, a: Math.min(seg(t, s.t0, s.t0 + .1), 1 - seg(t, s.t1 - .15, s.t1)) };
  return null;
}

export function render(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  const s = SHOTS.find(s => t >= s.t0 && t < s.t1) || SHOTS[SHOTS.length - 1];
  s.draw(g, t, t - s.t0);
}
