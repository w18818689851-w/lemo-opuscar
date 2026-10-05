// 输出尺寸 = 视口尺寸（渲染器截的是浏览器**视口**，不是 canvas）。canvas 必须跟着视口走，
// 否则 --size/--ratio 只会把 1920×1080 的画面裁掉一块；版面由 film.js 按实际帧（SW/SH）重排。
const q = new URLSearchParams(location.search);
if (q.get('look')) await import('./look.js');
else if (q.get('sheet')) await import('./sheet.js');
else if (q.get('api')) await import('./api.js');
else {
  const cv = document.getElementById('c');
  cv.width = window.innerWidth; cv.height = window.innerHeight;
  await import('./film.js');
}
