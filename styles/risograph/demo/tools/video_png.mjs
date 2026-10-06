// core/render/video.mjs 的副本：PNG 截图（JPEG 4:2:0 会吃掉粉/蓝网点的颜色），中间片 yuv444 无损
// node tools/video_png.mjs <demo> [--fps 24] [--workers 3] [--q 'k=v'] [--out <demo>/out/video.mp4]
//                             [--size 1920x1080] [--ratio 9:16] [--from 0] [--to <DUR>]
// 多个片子并行制作时 workers 用 3（默认），单独渲染可开到 6
// 每个 worker 独立浏览器，PNG 截图经管道交给 ffmpeg；最后无损拼接
// ★ --size / --ratio 与 core/render/video.mjs **同源**（core/render/page.mjs 的 takeSize）：
//   本文件是它的副本，画幅必须走同一条解析/校验（缺省仍是 1920x1080），绝不自己发明一套。
//   没有这个口时调用方（编排器）传 --size 会被**静默丢掉**、按 1920x1080 出片 —— 9:16 尤其明显。
import fs from 'fs'; import path from 'path'; import { spawn, execFileSync } from 'child_process';
import { openDemo, closeServer, requireDemo, takeSize } from '../../../../core/render/page.mjs';

// 编码器：**未设 LEMO_VENC ⇒ 走 GPU 的 h264_nvenc**（用户硬规则：渲染一律 GPU 优先）；
// 显式 libx264 才走 CPU；其它值报错退出，绝不静默回落 CPU。
// ⚠️ 本脚本是**无损中间片**（qp 0 / yuv444p）：nvenc 分支用 constqp 0 + high444p，见下方风险说明。
const VENC = process.env.LEMO_VENC || 'h264_nvenc';
if (VENC !== 'h264_nvenc' && VENC !== 'libx264') { console.error(`LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '${VENC}'. Refusing to fall back to the CPU encoder silently.`); process.exit(1); }
const VARG444 = VENC === 'h264_nvenc'
  ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'constqp', '-qp', '0', '-profile', 'high444p']
  : ['-c:v', 'libx264', '-preset', 'medium', '-qp', '0'];
const args = process.argv.slice(2), { w: W, h: H } = takeSize(args), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = args[0]; requireDemo(dir);
const FPS = +opt('--fps', 24), WK = +opt('--workers', 3), Q = opt('--q', '');
const outDir = path.join(dir, 'out'); fs.mkdirSync(outDir, { recursive: true });
const out = opt('--out', path.join(outDir, 'video.mp4'));
const probe = await openDemo(dir, { w: W, h: H, q: Q }); const DUR = await probe.page.evaluate(() => window.DUR); await probe.browser.close();
const F0 = Math.round(+opt('--from', 0) * FPS), TOTAL = Math.round(+opt('--to', DUR) * FPS) - F0, per = Math.ceil(TOTAL / WK), t0 = Date.now();
await Promise.all([...Array(WK)].map(async (_, w) => {
  const a = w * per, b = Math.min(TOTAL, a + per); if (a >= b) return;
  const { browser, page } = await openDemo(dir, { w: W, h: H, q: Q });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    ...VARG444, '-pix_fmt', 'yuv444p', path.join(outDir, `seg_${w}.mp4`)]);
  for (let f = a; f < b; f++) {
    await page.evaluate(t => window.render(t), (f + F0) / FPS);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - a) % 60 === 0) console.log(`w${w} ${f - a}/${b - a}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await browser.close();
}));
const list = path.join(outDir, 'segs.txt');
fs.writeFileSync(list, [...Array(WK)].map((_, w) => `file 'seg_${w}.mp4'`).filter((_, w) => w * per < TOTAL).join('\n'));
// ★ stdio 必须显式给成 ['ignore','inherit','inherit'] —— 与 core/render/video.mjs 的拼接那一行**逐字一致**。
//   本文件是它的副本，但这一处**漂移**过：默认 stdio 是 ['pipe','pipe','pipe']，而在本机（Windows + 本 Node 22）
//   spawnSync/execFileSync **只要走 pipe 就 EBUSY**（实测：默认 → EBUSY；'ignore'/'inherit' → status 0；
//   连 `spawnSync('cmd.exe',['/c','echo','hi'])` 都一样）。core 版早就显式传了这个选项（见 `lemo-make.mjs:261`
//   的同一条「本环境 spawnSync 一律 EBUSY」记载），副本漏掉了 ⇒ 拼接一步**必失败**（exit 1，
//   前 6 个分段全部白渲）。改成 inherit 还顺带让 ffmpeg 的报错能真的打到 stderr（pipe 时被 execFileSync 吞掉）。
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out],
  { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('done', out, TOTAL, 'frames', ((Date.now() - t0) / 1000).toFixed(0) + 's');
closeServer();
