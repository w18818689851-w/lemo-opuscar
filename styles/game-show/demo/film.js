// 画幅能力声明 —— 控制台按**源码文本**探测 `FILM_META.aspects`（D:\lemo-tools\lib\aspects.mjs），
// 而它只扫 `demo/film*.js`；本风格的影片本体是 `index.html` 里的**内联脚本**（由 `build.py` 把
// `frame_head.html` + `main.js` 内联而成，`main_b.js` / `main_v1.js` / `remix2026.js` 只是它的构建输入），
// 不在这个命名约定里，所以这里只放声明。
// ★ 页面**不** import 本文件（`index.html` 的内联脚本独立运行），改这里不影响渲染。
//
// 多比例的实现落在**页面外壳** `demo/index.html`：设计帧固定 1920×1080（影片本体一字未改），
// 当前帧 ≠ 1920×1080 时把**整张设计帧**等比装入（contain）并居中，留边 = 页面底色 #F4ECDD（米色纸底）。
// 所以下面每个比例都是真的能**正确构图**的（整幅画面都在，不裁切；代价见 SKILL.md）。
export const FILM_META = {
  id: 'rhythm-of-ai', title: 'Rhythm of AI, 1997 → 2026', style: 'Game Show Flat',
  aspects: ['16:9', '9:16', '3:4', '4:3', '1:1'],
};
