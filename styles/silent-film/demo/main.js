// The Runaway Loaf — page entry. window.render(t) draws frame t; ?scene=file.fn renders a test/sheet scene.
import * as ST from './stage.js';
const Q = new URLSearchParams(location.search);
const cv = document.getElementById('c'), g = cv.getContext('2d');
await Promise.all(['400 40px "Old Standard TT"', 'italic 400 40px "Old Standard TT"', '700 40px "Old Standard TT"', '900 40px "Playfair Display SC"', '700 40px "Playfair Display SC"', '400 40px "Playfair Display"', 'italic 700 40px "Playfair Display"'].map(f => document.fonts.load(f)));
// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；舞台由 stage.setFrame() 按实际帧重排
// （影院铺满整帧、4:3 片门按紧轴等比装入居中）。
cv.width = window.innerWidth; cv.height = window.innerHeight;
ST.setFrame(cv.width, cv.height);
const mods = {};
const film = await import('./film.js');
window.EV = film.events ? film.events() : [];
window.render = async t => {
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (Q.has('scene')) {
    const [file, fn] = Q.get('scene').split('.');
    const m = mods[file] || (mods[file] = await import('./' + file + '.js'));
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    await m[fn](g, t, Object.fromEntries(Q)); return;
  }
  film.renderFilm(g, t, Q);
};
window.DUR = film.DUR;
window.READY = true;
