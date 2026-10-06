// 极简静态服务器（ES module 不能走 file://）。只监听 127.0.0.1；请求必须落在根目录（或 /@film/ 挂载的片子目录）之内。
import http from 'http'; import fs from 'fs'; import path from 'path';
// 文本类一律声明 UTF-8：页面漏写 <meta charset> 时中文也不会变成乱码
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.hdr': 'application/octet-stream', '.bin': 'application/octet-stream', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };
// 仓库外的片子工程（skill 模式下在用户自己的文件夹里）挂在 /@film/ 下；/core/…、/styles/…、/node_modules/… 仍从仓库根取
const MOUNT = '/@film/'; let filmDir = null;
// Chrome/Chromium 在 URL 层就拒连一批「受限端口」（net/base/port_util.cc 的 kRestrictedPorts），
// 命中即 page.goto 抛 net::ERR_UNSAFE_PORT —— 跟我们的服务无关，纯属假失败（实测 2049 可完整复现）。
// 为什么必须处理：下面 listen(0) 由 OS 随机分配端口，而本机（Windows）动态端口范围是 1024–15000，
// 其中落着 17 个受限端口；6 万次 listen(0) 实测命中 72 次（0.120%，与理论 17/13974=0.122% 吻合，
// 其中 2049 命中 6 次）⇒ 43 个风格连跑一轮就有约 5% 的概率撞上一次。绑好后校验、命中就换。
// 表来源：https://raw.githubusercontent.com/chromium/chromium/main/net/base/port_util.cc（kRestrictedPorts，逐字核对）
const CHROME_BLOCKED_PORTS = new Set([0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995,
  1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080]);
const CHROME_PORT_RETRIES = 32;   // 连续 32 次都随机到受限端口（≈0.12%^32）才会放弃；到时端口照样能用，只是 Chrome 连不上
export function pageURL(root, port, dir) {
  const abs = path.resolve(dir), rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { filmDir = abs; return `http://127.0.0.1:${port}${MOUNT}index.html`; }
  return `http://127.0.0.1:${port}/${rel.split(path.sep).map(encodeURIComponent).join('/')}/index.html`;
}
// URL 路径 → 磁盘文件；出了根目录 / 解码失败 / 含 NUL 返回 { status }
export function resolveRequest(root, url) {
  let u; try { u = decodeURIComponent(url.split('?')[0].split('#')[0]); } catch { return { status: 400 }; }
  if (u.includes('\0')) return { status: 400 };
  const [base, rest] = filmDir && u.startsWith(MOUNT) ? [filmDir, u.slice(MOUNT.length)] : [root, u];
  const p = path.resolve(base, '.' + path.sep + rest.replace(/^\/+/, ''));
  if (p !== base && !p.startsWith(base + path.sep)) return { status: 403 };
  return { path: p };
}
export function serve(root, port = 0) {
  return new Promise(res => {
    // 显式要的端口若本身在受限表里（例如有人传 2049），直接当作 0 让 OS 随机挑 —— 否则 Chrome 必定连不上；
    // 未命中受限表的端口一律原样绑定（旧行为不变）。
    let want = CHROME_BLOCKED_PORTS.has(port) ? 0 : port, left = CHROME_PORT_RETRIES;
    const handler = (q, r) => {
      const send = (code, body) => { r.writeHead(code, { 'Content-Type': 'text/plain' }); r.end(body); };
      try {
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(q.headers.host || '')) return send(403, 'bad host');   // 挡 DNS rebinding
        const x = resolveRequest(root, q.url);
        if (x.status) return send(x.status, x.status === 403 ? 'outside root' : 'bad request');
        fs.readFile(x.path, (e, d) => {
          if (e) return send(404, 'not found');
          r.writeHead(200, { 'Content-Type': T[path.extname(x.path).toLowerCase()] || 'application/octet-stream' }); r.end(d);
        });
      } catch { send(400, 'bad request'); }
    };
    const start = () => {
      const s = http.createServer(handler);
      s.listen(want, '127.0.0.1', () => {
        const got = s.address().port;
        // 随机端口撞上 Chrome 黑名单 ⇒ 关掉重来（换成 OS 随机）；上限用尽就照常返回，不再空转
        if (CHROME_BLOCKED_PORTS.has(got) && --left > 0) { want = 0; s.close(start); return; }
        res({ server: s, port: got });
      });
    };
    start();
  });
}
