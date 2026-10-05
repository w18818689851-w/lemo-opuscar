// 渲视频：node render/video.mjs [--fps 30] [--workers 6] [--from s] [--to s] [--out out/video.mp4]
import fs from 'fs'; import path from 'path'; import { spawn, execFileSync } from 'child_process';
import { openPage, closeServer, ROOT } from './page.mjs';

// 编码器：**未设 LEMO_VENC ⇒ 走 GPU 的 h264_nvenc**（用户硬规则：渲染一律 GPU 优先）；
// 显式 libx264 才走 CPU；其它值报错退出，绝不静默回落 CPU（把 h264_nvenc 打错会以为在用显卡、实际走 CPU）。
const VENC = process.env.LEMO_VENC || 'h264_nvenc';
if (VENC !== 'h264_nvenc' && VENC !== 'libx264') { console.error(`LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '${VENC}'. Refusing to fall back to the CPU encoder silently.`); process.exit(1); }
// 编码参数：nvenc 的 cq ≈ 原 libx264 的 crf + 5；显式 libx264 时保持原参数。
const vencArgs = (crf, preset = 'medium') => VENC === 'h264_nvenc'
  ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(crf + 5), '-b:v', '0']
  : ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf)];
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const FPS = +opt('--fps', 30), WK = +opt('--workers', 6), q = opt('--q', '');
const outDir = path.join(ROOT, 'out'); fs.mkdirSync(outDir, { recursive: true });
const out = path.resolve(opt('--out', path.join(outDir, 'video.mp4')));
const segDir = path.dirname(out); fs.mkdirSync(segDir, { recursive: true });   // 分段文件写在输出文件旁边
const probe = await openPage(q); const DUR = await probe.page.evaluate(() => window.DUR); await probe.browser.close();
const F0 = Math.round(+opt('--from', 0) * FPS), F1 = Math.round(+opt('--to', DUR) * FPS);
const TOTAL = F1 - F0, per = Math.ceil(TOTAL / WK), t0 = Date.now();
await Promise.all([...Array(WK)].map(async (_, w) => {
  const a = F0 + w * per, b = Math.min(F1, a + per); if (a >= b) return;
  const { browser, page } = await openPage(q);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    ...vencArgs(12), '-pix_fmt', 'yuv420p', path.join(segDir, `seg_${w}.mp4`)]);
  for (let f = a; f < b; f++) {
    await page.evaluate(t => window.render(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - a) % 90 === 0) console.log(`w${w} ${f - a}/${b - a}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await browser.close();
}));
const list = path.join(segDir, 'segs.txt');
fs.writeFileSync(list, [...Array(WK)].map((_, w) => `file 'seg_${w}.mp4'`).filter((_, w) => w * per < TOTAL).join('\n'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
console.log('done', out, TOTAL, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's');
closeServer();
