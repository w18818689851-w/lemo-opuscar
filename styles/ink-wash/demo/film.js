// 影片模块：只负责**画幅声明**，渲染实现仍在 shots.js（本片原本没有 film*.js，为让控制台的能力探测
// 能读到 aspects 而加这一层薄壳）。aspects 是**字面量**（控制台按源码文本探测，见 D:\lemo-tools\lib\aspects.mjs），
// 不写 = 只支持 16:9。这里列 16:9 与 9:16：手卷世界经 world.js 的 camXf 把设计帧**等比装入**当前帧
// （整幅画面始终可见、上下补宣纸留白），屏幕空间的家什（题跋/片尾卡/绫裱）随帧 fit。
// 1920×1080 时 S = 1、偏移 0 ⇒ 与改造前逐字节一致。
export const FILM_META = {
  id: 'the-swordsman-and-the-river',
  title: 'The Swordsman and the River',
  style: 'Chinese Ink Wash',
  aspects: ['16:9', '9:16'],
};

export { init, frame, subPos, events, seal } from './shots.js';
