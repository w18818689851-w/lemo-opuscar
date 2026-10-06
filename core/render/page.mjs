// 打开 demo 页面（仓库根为静态服务根；库外的片子工程挂在 /@film/ 下），等待 window.READY
// 出错要大声：页面里的 JS 报错、脚本（<script>、模块 import，resourceType 为 script）或页面本身（document）加载失败都会立即退出（非 0）。
// 其它类型（fetch / xhr / 图片 / 字体…）404 只打印一行警告：很多 demo 会 fetch 可选的 voices/dur.json，没有就用默认值
import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { serve, pageURL } from './serve.mjs';
import { EXE, ARGS, warnIfSoftwareGL } from './browser.mjs';
import { resolveSize, RATIOS, DEFAULT_RATIO, FALLBACK_SIZE, MIN_SIZE, MAX_SIZE } from './size.mjs';
export { RATIOS, DEFAULT_RATIO } from './size.mjs';   // 上层（出片流程）要查默认比例与可选清单时从这里拿
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let srv = null;
export async function server() { if (!srv) srv = await serve(ROOT); return srv; }
// 每个入口脚本在建任何输出目录之前先调它
export function requireDemo(dir) {
  if (!dir || dir.startsWith('--')) { console.error('usage: <demo> is the folder that holds index.html (see core/README.md)'); process.exit(2); }
  if (!fs.existsSync(path.join(dir, 'index.html'))) { console.error(`no index.html in "${dir}": the demo folder is wrong or the page isn't there yet`); process.exit(2); }
}
// --size WxH（默认 1920x1080）：从 args 里取走这一对，返回 { w, h }。宽高须为偶数（H.264 yuv420p 的要求），
// MIN_SIZE–MAX_SIZE（下限由 size.mjs 依据渲染器的几何下限定出，见那里的推导）。
// --ratio <spec>：与 --size 同义，但多接受比例写法（9:16、16:9、3:4、4:3、1:1）。--size 优先级高于 --ratio。
// 两个都不给时返回 1920x1080（**旧行为不变**）。为什么不把缺省改成 DEFAULT_RATIO（9:16）：
// still.mjs / video.mjs 是全库 35 个 demo/build.sh（43 个风格里 8 个没带 build.sh）直接调的低层工具，
// 它们都不传 --size、全按 1920x1080 构图；把低层缺省改成 9:16 会让这 35 部示例片当场全坏。
// 「默认 9:16」落在出片流程（lemo-make 编排器与控制台），那里会显式传尺寸。缺省比例可用 DEFAULT_RATIO 查（本模块已 re-export）。
// 口径：ls styles/*/demo/build.sh | wc -l = 35；grep -l -- --size styles/*/demo/build.sh 为空（没有一个传尺寸）。
export function takeSize(args) {
  // ★ 取值必须区分「没给这个选项」与「给了但没跟值」：
  //   前者用 null（走缺省），后者**必须报错**。旧实现两种都得到 undefined，而下面用 `!= null` 判空
  //   会把 undefined 当成「没给」⇒ `still.mjs <demo> 12.0 --ratio` 会**静默**按 1920x1080 出图，
  //   把「参数写错该报错」变成「悄悄用了错的尺寸」。这是相对旧实现的回归，独立验证时实测到。
  const take = k => {
    const i = args.indexOf(k);
    if (i < 0) return null;                 // 没给这个选项
    const v = args.splice(i, 2)[1];
    return v === undefined ? '' : v;        // 给了但悬空 → 空串，下面按非法值报错
  };
  const sizeV = take('--size'), ratioV = take('--ratio');
  if (sizeV != null) {   // --size 更具体，优先
    const r = sizeV === '' ? null : resolveSize({ size: sizeV });
    if (!r) {
      console.error(sizeV === ''
        ? 'bad --size: it needs a value, e.g. --size 1080x1920'
        : `bad --size "${sizeV}": use WxH with even numbers from ${MIN_SIZE} to ${MAX_SIZE}, e.g. 1080x1920`);
      process.exit(2);
    }
    return r;
  }
  if (ratioV != null) {
    const r = ratioV === '' ? null : resolveSize({ ratio: ratioV });
    if (!r) {
      console.error(ratioV === ''
        ? `bad --ratio: it needs a value, e.g. --ratio ${DEFAULT_RATIO}`
        : `bad --ratio "${ratioV}": use one of ${RATIOS.map(x => x.id).join(', ')} (default ${DEFAULT_RATIO}), or a custom WxH like 1080x1920 with even numbers from ${MIN_SIZE} to ${MAX_SIZE}`);
      process.exit(2);
    }
    return r;
  }
  return { ...FALLBACK_SIZE };
}
const warned = new Set();   // 整个进程里每个可选文件只警告一次（video.mjs 会开好几个页面）
const FATAL = new Set(['script', 'document']);   // 页面必须有的东西；模块 import 的类型也是 script
export async function openDemo(dir, { w = 1920, h = 1080, q = '', warnings = false } = {}) {
  requireDemo(dir);
  const { port } = await server();
  const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const log = [];   // 最近的报错，READY 迟迟不来时一起打印
  const note = s => { log.push(s); if (log.length > 8) log.shift(); console.error(s); };
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && /^Failed to load resource/.test(t)) return;   // 由下面的 response 事件带 URL 打印
    if (m.type() === 'error' || (warnings && m.type() === 'warning')) note('[page] ' + t.slice(0, 300));
  });
  page.on('pageerror', e => { console.error('[pageerror]', e.message); process.exit(1); });   // 渲染中报错就停，免得产出坏片
  page.on('response', r => {
    if (r.status() < 400) return;
    const u = r.url(), p = new URL(u).pathname, type = r.request().resourceType();
    if (p === '/favicon.ico') return;
    if (FATAL.has(type)) {
      note(`[page] ${r.status()} ${u}`);
      console.error(`the page needs ${p} (a ${type}) but the server answered ${r.status()}. Check the path: pages use absolute URLs like /core/lib.js (see core/README.md)`); process.exit(1);
    }
    if (!warned.has(u)) { warned.add(u); note(`[page] optional file missing: ${u} (${r.status()}, requested by ${type === 'fetch' || type === 'xhr' ? 'fetch/xhr' : type}; fine if the page has a fallback)`); }
  });
  page.on('requestfailed', r => { if (!/favicon/.test(r.url()) && r.failure()?.errorText !== 'net::ERR_ABORTED') note(`[page] request failed ${r.url()} (${r.failure()?.errorText})`); });
  await page.goto(pageURL(ROOT, port, dir) + (q ? '?' + q : ''));
  const hint = setTimeout(() => {
    console.error(`still waiting for window.READY after 20 s. The page has to set window.READY = true once fonts and images are loaded.\n` +
      (log.length ? '  problems seen so far:\n    ' + log.join('\n    ') + '\n' : '  no console errors so far: is the <script> closed, does it reach the line that sets window.READY?\n') +
      `  debug: node core/render/still.mjs ${dir} 0, or open the page in a normal browser (the tools serve the library root on 127.0.0.1)`);
  }, 20000);
  const t0 = Date.now();
  try { await page.waitForFunction(() => window.READY === true, null, { timeout: 180000 }); }
  catch (e) { console.error(`window.READY never became true (waited ${((Date.now() - t0) / 1000).toFixed(0)} s, limit 180 s): ${e.message.split('\n')[0]}`); process.exit(1); }
  finally { clearTimeout(hint); }
  await warnIfSoftwareGL(page);
  return { browser, page };
}
export function closeServer() { if (srv) srv.server.close(); }
