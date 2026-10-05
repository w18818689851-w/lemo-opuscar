const q = new URLSearchParams(location.search);
const mod = await import(q.get('test') ? './test.js' : './film.js');
// 渲染器截的是浏览器**视口**（--size/--ratio 改它）：画布跟视口走，并把帧尺寸透给影片模块。
const VW = window.innerWidth, VH = window.innerHeight;
const draw = await mod.setup(document.getElementById('c'), { W: VW, H: VH });
window.render = t => draw(t, { W: VW, H: VH });
render(0); window.READY = true;
