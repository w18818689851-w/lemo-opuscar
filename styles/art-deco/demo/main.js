import { setFrame, S, W, H } from './frame.js';
const Q = new URLSearchParams(location.search);
const cv = document.getElementById('c'), g = cv.getContext('2d');
await Promise.all(['80px Limelight', '80px Poiret', '600 40px Josefin', '400 40px Josefin', '700 40px Josefin', '80px Italiana'].map(f => document.fonts.load(f)));
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；画面由 frame.setFrame() 按实际帧等比装入。
cv.width = window.innerWidth; cv.height = window.innerHeight;
setFrame(cv.width, cv.height);
const mods = {};
let film = null;
if (!Q.has('scene')) {
  film = await import('./film.js');
  if (film.init) await film.init();
  window.EV = film.events ? film.events() : [];
  window.DUR = film.DUR;
}
window.render = async t => {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  if (Q.has('scene')) {
    const [file, fn] = Q.get('scene').split('.');
    const m = mods[file] || (mods[file] = await import('./' + file + '.js'));
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    const bx = W / 2 - 960 * S, by = H / 2 - 540 * S;                     // 图纸（sheet）也按整幅等比装入并裁到设计帧
    g.save(); g.beginPath(); g.rect(bx, by, 1920 * S, 1080 * S); g.clip(); g.transform(S, 0, 0, S, bx, by);
    await m[fn](g, t, Object.fromEntries(Q)); g.restore(); return;
  }
  film.renderFilm(g, t, Q);
};
if (!window.DUR) window.DUR = 1;
window.READY = true;
