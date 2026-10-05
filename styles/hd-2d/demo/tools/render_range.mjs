// 只渲一段时间：node styles/hd-2d/demo/tools/render_range.mjs <a> <b> [--fps 60] [--workers 2] [--q 'tilt=1'] [--out styles/hd-2d/demo/out/range.mp4]
// 与 core/render/video.mjs 同一套逐帧截图管线（同样的 JPEG q95 → x264 crf14），只是帧号范围是 [round(a*fps), round(b*fps))。
// 用途：改片尾字卡后只重渲最后几秒，再与原 video_tilt.mp4 的前段拼接（见 ../../DEMO.md「Build notes」的 Partial re-render / ../PRODUCTION_LOG.md）。
import fs from 'fs'; import path from 'path'; import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { openDemo, closeServer } from '../../../../core/render/page.mjs';

// 编码器：**未设 LEMO_VENC ⇒ 走 GPU 的 h264_nvenc**（用户硬规则：渲染一律 GPU 优先）；
// 显式 libx264 才走 CPU；其它值报错退出，绝不静默回落 CPU（把 h264_nvenc 打错会以为在用显卡、实际走 CPU）。
const VENC = process.env.LEMO_VENC || 'h264_nvenc';
if (VENC !== 'h264_nvenc' && VENC !== 'libx264') { console.error(`LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '${VENC}'. Refusing to fall back to the CPU encoder silently.`); process.exit(1); }
// 编码参数：nvenc 的 cq ≈ 原 libx264 的 crf + 5；显式 libx264 时保持原参数。
const vencArgs = (crf, preset = 'medium') => VENC === 'h264_nvenc'
  ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(crf + 5), '-b:v', '0']
  : ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf)];
const DEMO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const A = +args[0], B = +args[1], FPS = +opt('--fps', 60), WK = +opt('--workers', 2), Q = opt('--q', 'tilt=1');
const out = path.resolve(opt('--out', path.join(DEMO, 'out', `range_${A}_${B}.mp4`)));
const tmp = path.join(DEMO, 'out', 'range_tmp'); fs.mkdirSync(tmp, { recursive: true });
const F0 = Math.round(A * FPS), F1 = Math.round(B * FPS), TOTAL = F1 - F0, per = Math.ceil(TOTAL / WK), t0 = Date.now();
await Promise.all([...Array(WK)].map(async (_, w) => {
  const a = F0 + w * per, b = Math.min(F1, a + per); if (a >= b) return;
  const { browser, page } = await openDemo(DEMO, { q: Q });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    ...vencArgs(14), '-pix_fmt', 'yuv420p', path.join(tmp, `seg_${w}.mp4`)]);
  for (let f = a; f < b; f++) {
    await page.evaluate(t => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - a) % 60 === 0) console.log(`w${w} ${f - a}/${b - a}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await browser.close();
}));
const list = path.join(tmp, 'segs.txt');
fs.writeFileSync(list, [...Array(WK)].map((_, w) => `file 'seg_${w}.mp4'`).filter((_, w) => w * per < TOTAL).join('\n'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
const sec = (Date.now() - t0) / 1000;
console.log('done', out, TOTAL, 'frames', sec.toFixed(1) + 's', (TOTAL / sec).toFixed(1) + ' fps');
closeServer(); process.exit(0);   // 静态服务器的 keep-alive 连接会让进程挂住
