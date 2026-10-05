// 画幅能力声明 —— 控制台按**源码文本**探测 `FILM_META.aspects`（D:\lemo-tools\lib\aspects.mjs），
// 而它只扫 `demo/film*.js`；本风格的影片本体是 `main.js`（three.js + 微距相机），不在这个命名约定里，
// 所以这里只放声明。★ 页面**不** import 本文件（`index.html` 仍 import `./main.js`），改这里不影响渲染。
//
// 多比例的实现落在**页面外壳** `demo/index.html`：设计帧固定 1920×1080（影片本体一字未改，
// main.js 的 `renderer.setSize(1920,1080)` 不跟视口走），当前帧 ≠ 1920×1080 时把**整张设计帧**
// 等比装入（contain）并居中，留边 = 页面底色 #fffaf0（本风格 palette 的 bg，纸白）。
// 所以下面每个比例都是真的能**正确构图**的（整幅画面都在，不裁切；代价见 SKILL.md）。
export const FILM_META = {
  id: 'pips-paper-adventure', title: "Pip's Paper Adventure", style: 'Paper Pop-up Book',
  aspects: ['16:9', '9:16', '3:4', '4:3', '1:1'],
};
