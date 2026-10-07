import { clamp, seg, eo, eio, back, hash } from '../../../core/lib.js';
import * as UI from './ui.js';
import * as CW from './clawd.js';
import * as FM from './film.js';

const Q = new URLSearchParams(location.search), NOSUBS = Q.has('nosubs');
const wL = document.getElementById('wL'), wD = document.getElementById('wD'), spr = document.getElementById('spr'), hudEl = document.getElementById('hud');
const mbg = document.getElementById('mbg'), mbw = document.getElementById('mbw'), fit = document.getElementById('fit'), stage = document.getElementById('stage');

// ── 设计帧(1920×1080) → 当前帧：渲染器把浏览器**视口**设成输出尺寸（--size/--ratio），页面据实际视口重排。
// 这是「世界相机 + 全屏叠加」的混合风格，两套坐标各归各的：
//   · 世界层（相机里的桌面/窗口/Claude 应用/精灵/片尾卡）统一「中心对齐 + 紧轴缩放 S」装入当前帧（相机 zoom 不动）；
//   · HUD 贴**当前帧**：尺寸按 S、贴边位置按 FX/FY（CSS 变量 --s/--fx/--fy），全屏叠加（划像/闪光/淡出/聚光）
//     因此能盖满整帧；世界映射类的屏幕位置由 scr() 用「世界 → 当前帧」换算给出。
// 1920×1080 时 FX = FY = S = 1、偏移 0 ⇒ 不套变换、calc 退化成原数字 ⇒ 逐字节等于改造前。
const NATIVE = { W: 1920, H: 1080 };
const W = window.innerWidth, H = window.innerHeight;
const FX = W / NATIVE.W, FY = H / NATIVE.H, S = Math.min(FX, FY);
const OX = (W - NATIVE.W * S) / 2, OY = (H - NATIVE.H * S) / 2, FIT = S !== 1 || OX || OY;
if (FIT) {
  fit.style.transform = `translate(${OX}px,${OY}px) scale(${S})`;
  hudEl.style.setProperty('--s', S); hudEl.style.setProperty('--fx', FX); hudEl.style.setProperty('--fy', FY);
}

// voices/words.json、voices/dur.json 是**生成物**（.gitignore:138，未构建时不在检出里）。
// 真表是 whisper 在配音上打的逐词时间戳（相对本句 VO 起点）：[word, start, end]。
// 缺失时**合成**一张同形的表：把本句 (asr || text) 的词在 [本句 VO, 下一句 VO) 内均分。
// 这样 W()/WE() 仍能按词命中，影片骨架（打字、光标、字幕）照样成立 —— 只是节奏变成均匀的近似。
const fetchJ = async (u, d) => { try { const r = await fetch(u); return r.ok ? await r.json() : d; } catch { return d; } };
async function voicesWords() {
  const w = await fetchJ('voices/words.json', null);
  if (w) return w;
  const lines = await fetchJ('lines.json', []), ids = Object.keys(FM.VO), out = {};
  ids.forEach((id, i) => {
    const L = lines.find(l => l.id === id); if (!L) { out[id] = []; return; }
    const t0 = FM.VO[id], t1 = i + 1 < ids.length ? FM.VO[ids[i + 1]] : FM.DUR;
    const toks = (L.asr || L.text).split(/\s+/).filter(Boolean), step = (t1 - t0) / toks.length;
    out[id] = toks.map((x, k) => [x, k * step, (k + 1) * step]);
  });
  return out;
}
const words = await voicesWords();
words.__dur = await fetchJ('voices/dur.json', {});
FM.build(words);
window.DUR = FM.DUR;
window.EV = FM.EV.slice().sort((a, b) => a.t - b.t);
window.SUBS = FM.SUBS.map(s => ({ t0: s.t0, t1: s.t1, text: s.text.replace(/[{}]/g, '') }))    // 片尾两句画面上已有大字，不烧录，但进 .srt
  .concat([['v16', 'Claude Code.'], ['v17', 'Say it. Plan it. Review it. Ship it.']].map(([id, text]) => ({ t0: FM.VO[id] - .05, t1: FM.VO[id] + (words.__dur[id] || 2) + .3, text })));
window.T = FM.T;

const tf = ([cx, cy, z]) => `translate(960px,540px) scale(${z}) translate(${-cx}px,${-cy}px)`;
function render(t) {
  const F = FM.frame(t), [cx, cy, z] = F.cam;
  if (FIT) stage.style.background = F.dark.base === 'D' ? '#171614' : '#E9E1D1';   // 设计帧外的留边跟随当前主题的地色
  const html = UI.desk(F.desk) + (F.app ? UI.appWin(F.app, t) : '') + (F.extra || '');
  const D = F.dark, base = D.base === 'L' ? wL : wD, over = D.over ? (D.over === 'L' ? wL : wD) : null;
  base.innerHTML = html; base.style.display = ''; base.style.clipPath = ''; base.style.zIndex = 1;
  if (over) { over.innerHTML = html; over.style.display = ''; over.style.zIndex = 2; } else (base === wL ? wD : wL).style.display = 'none';
  for (const el of [wL, wD, spr]) el.style.transform = tf(F.cam);
  // 锚点：元素上一点的世界坐标（getBoundingClientRect 是**视口**像素，先经 #fit 的装入变换还原回设计帧）
  const cache = {};
  const A = (key, fx = .5, fy = 0) => { const el = cache[key] !== undefined ? cache[key] : (cache[key] = base.querySelector(`[data-a="${key}"]`));
    if (!el) return null; const r = el.getBoundingClientRect();
    const l = (r.left - OX) / S, t = (r.top - OY) / S, bw = r.width / S, bh = r.height / S;
    return { x: (l + bw * fx - 960) / z + cx, y: (t + bh * fy - 540) / z + cy, w: bw / z, h: bh / z }; };
  if (over) { const c = A(D.at, .5, D.at === 'toggle' ? .5 : .6) || { x: 960, y: 540 }; over.style.clipPath = `circle(${D.r}px at ${c.x}px ${c.y}px)`; }
  // 动态模糊：镜头速度 → 各向异性高斯（录屏软件的甩镜感）
  const [px, py, pz] = FM.camAt(t - 1 / 24), vx = (cx - px) * z, vy = (cy - py) * z, vz = Math.abs(Math.log(z / pz)) * 900;
  const bx = Math.min(36, Math.max(0, Math.abs(vx) - 30) * .3), by = Math.min(36, Math.max(0, Math.abs(vy) - 30) * .3);   // 慢推保持清晰，只有甩镜才拖影
  const mb = bx > .6 || by > .6; mbg.setAttribute('stdDeviation', `${bx.toFixed(2)} ${by.toFixed(2)}`);
  mbw.style.filter = mb ? 'url(#mb)' : ''; window.DBG = { bx, by, vx, vy, vz, cam: F.cam };
  // 精灵层
  spr.innerHTML = sprites(F, t, A, z) + F.fx.map(f => f(A)).join('');
  hud(F, t, A, z, cx, cy);
}
function sprites(F, t, A, z) {
  const T = FM.T; let h = '';
  const draw = (act, tag) => {
    const c = act.eval(t, A, F); if (!c) return null;
    h += CW.sprite(c);
    const s = act.seg(t);
    if (s && s.pencil) h += CW.PENCIL(c.flip ? c.x - 9 * c.px - 6 * c.px : c.x + 6 * c.px, c.y - 7 * c.px, c.px);
    if (s && s.dash) h += CW.speedlines(c.x, c.y, 1, seg(t, s.t0, s.t1) * .8 + .1, 4);
    // 落地尘土
    for (const j of act.jumps) if (t >= j.t1 && t < j.t1 + .4) { const L = act.eval(j.t1 + .001, A, F); if (L) h += CW.dust(L.x, L.y, seg(t, j.t1, j.t1 + .4), Math.max(3, L.px * .7), 6, j.t1 * 10); }
    return c;
  };
  const c1 = draw(F.actors[0]), c2 = draw(F.actors[1]);
  // 表演附件
  if (c1) {
    const top = c1.y - c1.px * 10;
    if (t > T.land0 && t < T.land0 + .7) h += CW.BANG(c1.x - 3 * c1.px + 60, top - 70, 5, 1 - seg(t, T.land0 + .5, T.land0 + .7));
    if (t > T.land1 && t < T.land1 + .5) { const k = seg(t, T.land1, T.land1 + .5); h += CW.SPARK(c1.x - 90 - k * 30, top - 10 - k * 20, 6, '#F2C14E', 1 - k) + CW.SPARK(c1.x + 90 + k * 30, top - 20 - k * 20, 5, '#F2C14E', 1 - k); }
    if (t > T.planSel + .35 && t < T.plan) h += CW.DOTS(c1.x + 60, top - 20, 5, 1 + Math.floor((t - T.planSel) * 5) % 3);
    if (t > T.readEnd && t < T.readEnd + .9) h += CW.CHECK(c1.x + 50, top - 34, 5, 1 - seg(t, T.readEnd + .6, T.readEnd + .9));
    if (t > T.cmSend + .1 && t < T.rev - .2) h += CW.BANG(c1.x + 30, top - 64, 5);
    if (t > T.pet && t < T.pet + .9) { const k = seg(t, T.pet, T.pet + .9); h += CW.HEART(c1.x + 40 + k * 16, top - 20 - k * 50, 5, 1 - k * k); }
    if (t > T.stomp && t < T.stomp + .6) { const k = seg(t, T.stomp, T.stomp + .6); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + .3; h += CW.SPARK(c1.x + Math.cos(a) * (30 + k * 60), c1.y - 20 + Math.sin(a) * (20 + k * 40), 4, '#F2C14E', 1 - k); } }
    if (t > T.merged && t < T.merged + .8) h += CW.SPARK(c1.x + 50, top - 30 - seg(t, T.merged, T.merged + .8) * 30, 5, '#F2C14E', 1 - seg(t, T.merged + .4, T.merged + .8));
    if (t > T.light && t < T.light + .8) { const k = seg(t, T.light, T.light + .8); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; h += CW.SPARK(c1.x + Math.cos(a) * (40 + k * 110), c1.y - 30 + Math.sin(a) * (30 + k * 80), 6, i % 2 ? '#F2C14E' : CW.CLAY, 1 - k); } }
  }
  // 分裂 / 合体的像素爆散
  const burst = (x, y, k, n = 14) => { let s = ''; for (let i = 0; i < n; i++) { const a = hash(i * 2.3) * Math.PI * 2, r = (20 + hash(i * 7.7) * 70) * eo(k), sz = 7 * (1 - k * .6);
    s += `<div style="position:absolute;left:${x + Math.cos(a) * r}px;top:${y + Math.sin(a) * r * .7}px;width:${sz}px;height:${sz}px;background:${i % 3 ? CW.CLAY : '#F2C14E'};opacity:${1 - k}"></div>`; } return s; };
  if (t > T.split + .15 && t < T.split + .6 && c1) h += burst(c1.x, c1.y - 30, seg(t, T.split + .15, T.split + .6));
  if (t > T.meet && t < T.meet + .6) h += burst(960, 440, seg(t, T.meet, T.meet + .6), 22);
  // 光标（带运动残影）
  const cu = F.cursor.eval(t, A);
  if (cu) {
    if (cu.sp > 900) for (let i = 1; i <= 4; i++) { const g = F.cursor.eval(t - i * .012, A); if (g) h += cursorSvg(g.x, g.y, 1, cu.op * .16 * (5 - i) / 4, z); }
    if (cu.ring > 0) h += `<div class="ring" style="left:${cu.x - 26 * cu.ring - 4}px;top:${cu.y - 26 * cu.ring - 4}px;width:${52 * cu.ring + 8}px;height:${52 * cu.ring + 8}px;opacity:${(1 - cu.ring) * .8};border-width:${3 / z}px"></div>`;
    h += cursorSvg(cu.x, cu.y, cu.sc, cu.op, z);
  }
  return h;
}
// 光标按屏幕尺寸恒定（1.6 倍系统大小，录屏软件常用）
const cursorSvg = (x, y, sc, op, z) => { const s = 1.6 * sc / z;
  return `<svg style="position:absolute;left:${x - 2 * s}px;top:${y - 2 * s}px;opacity:${op};filter:drop-shadow(0 ${2 / z}px ${3 / z}px rgba(0,0,0,.3))" width="${22 * s}" height="${30 * s}" viewBox="0 0 22 30"><path d="M2 2 L2 24 L7.5 18.5 L11 27 L15 25.2 L11.6 17 L19 17 Z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`; };

function hud(F, t, A, z, cx, cy) {
  const HU = F.hud; let h = '';
  // 世界坐标 → 当前帧像素（HUD 贴当前帧，所以这里把设计帧的取景结果再经 #fit 的装入变换映射出去）
  const scr = p => ({ x: OX + S * ((p.x - cx) * z + 960), y: OY + S * ((p.y - cy) * z + 540) });
  if (HU.spot) { const p = A(HU.spot.key, .5, .5); if (p) { const s = scr(p), r = (Math.max(p.w, p.h) * z * .75 + 40) * S;
    h += `<div class="spot" style="opacity:${HU.spot.op};background:radial-gradient(ellipse ${r * 1.6}px ${r}px at ${s.x}px ${s.y}px, transparent 60%, rgba(25,22,18,.55) 100%)"></div>`; } }
  if (HU.toast) { const p = A(HU.toast.key, .5, .72); if (p) { const s = scr(p); h += `<div class="toast" style="left:${s.x - 150 * S}px;top:${s.y}px;opacity:${HU.toast.op}">${HU.toast.text}</div>`; } }
  if (HU.flash) h += `<div class="flash" style="opacity:${HU.flash}"></div>`;
  if (HU.chap && !HU.wipe) h += `<div class="chap ${HU.dark ? 'dk' : ''}" style="opacity:${HU.chap.op}"><b>${HU.chap.no}</b>${HU.chap.nm}</div>`;
  if (HU.ramp) h += `<div class="ramp" style="opacity:${HU.ramp.op}">${HU.ramp.blink ? '▶▶' : '▷▷'} 4×</div>`;
  if (HU.keys) h += `<div class="keys" style="opacity:${HU.keys.op};transform:translateY(${HU.keys.y * S}px)">${HU.keys.keys.map(k => `<i class="${HU.keys.dn ? 'dn' : ''}">${k}</i>`).join('')}<span>${HU.keys.label}</span></div>`;
  if (HU.cap && !NOSUBS) h += `<div class="cap ${HU.dark ? 'dk' : ''}" style="opacity:${HU.cap.op};transform:translate(-50%,${HU.cap.y * S}px)">${HU.cap.text.replace(/\{([^}]*)\}/g, '<em>$1</em>')}</div>`;
  if (HU.wipe) h += wipe(HU.wipe, t);
  if (HU.fade) h += `<div class="fade" style="opacity:${HU.fade}"></div>`;
  if (t < .5) h += `<div class="fade" style="opacity:${1 - eo(t / .5)}"></div>`;
  hudEl.innerHTML = h;
}
// 章节转场：像素块从左下扫到右上盖满 → 标题 → 同向揭开；中间一只奶油色小 Clawd 跑过
// HUD 贴当前帧，所以块阵要按**当前帧**铺满（块边长 60×S、行列数由视口算出）；1920×1080 时退化成 32×18 块。
function wipe(WS, t) {
  const BS = 60 * S, cols = Math.ceil(W / BS), rows = Math.ceil(H / BS), p = WS.p; let s = '<div class="wipe">';
  const pal = ['#D97757', '#CF6E4E', '#E08A6B'];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const d = (c / cols) * .55 + ((rows - r) / rows) * .2 + hash(c * 13.1 + r * 7.7) * .12;
    const a = clamp((p / .42 - d) / .18), b = clamp(((p - .55) / .42 - d) / .18), k = a * (1 - b);
    if (k <= 0) continue; const sz = BS * k;
    s += `<b style="left:${c * BS + (BS - sz) / 2}px;top:${r * BS + (BS - sz) / 2}px;width:${sz + .5}px;height:${sz + .5}px;background:${pal[Math.floor(hash(c * 3.7 + r * 11.3) * 3)]}"></b>`;
  }
  const lo = clamp(Math.min((p - .3) / .12, (.82 - p) / .1));
  if (lo > 0) {
    s += `<div class="wlabel" style="opacity:${lo};transform:translateY(calc(-50% + ${(1 - lo) * 16 * S}px))"><div class="no">${WS.no}</div><div class="nm">${WS.nm}</div></div>`;
    const x = (300 + p * 1320) * FX; s += CW.sprite({ x, y: 790 * FY, px: 6, legs: Math.floor(t * 12) % 2 ? 'walkA' : 'walkB', op: lo }).replace(/fill="#D97757"/g, 'fill="#FFF8F0"').replace(/fill="#B85F40"/g, 'fill="#F3DCCD"');
  }
  return s + '</div>';
}
window.render = render;
await document.fonts.load('16px Inter'); await document.fonts.load('40px News'); await document.fonts.load('italic 40px News'); await document.fonts.load('14px Mono');
render(+(Q.get('t') || 0));
window.READY = true;
