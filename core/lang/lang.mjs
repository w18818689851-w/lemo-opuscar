// core/lang/lang.mjs — 语言注册表（「语言版本」功能版块）
//
// 一份 content 文件 = 一个语言版本。片子代码不认识语言，只认识这里的一条记录：
//
//   1) 页面（styles/<style>/demo/main.js）拿到 content 之后按语言预载字体：
//        const C = await (await fetch(q.get('content') || 'content.json')).json();
//        const L = langOf(C);                                   // C.lang 决定语言；缺省 / 未知回退 en
//        await Promise.all(fontsToLoad(L).map(f => document.fonts.load(f)));
//      index.html 里除了风格自己的 fonts.css，还要挂上 L.css 指向的语言字体表
//      （用库根绝对路径，例如 /core/lang/fonts-zh.css，见 core/render/page.mjs）。
//
//   2) 影片模块（styles/<style>/demo/film_*.js）在 makeFilm 开头：
//        const L = langOf(C);
//        if (plate.setFonts) plate.setFonts(L.fonts); else Object.assign(FONTS, L.fonts);
//        字距一律取 L.track.<键>；圆窗编号用 L.labelPrefix；站点刻名优先取 C.stations[key]，
//        没有才回落到风格自带的拉丁刻名。拉丁学名（学名、binomial）取 L.fonts.latin，别被中文字族抢走。
//      LINES 的文本锚点必须从 C 派生（标题、各站刻名），换语言时自动跟着变，不许写死拉丁串。
//
//   3) 配音（core/tts）的 lang / voice / speed 取 L.tts；字幕文本本来就来自 C.voice.lines[].text。
//      L.tts.engine 决定用哪个后端：缺省 / 'kokoro' = core/tts/tts.py（离线，音色一般）；
//      'indextts' = core/tts/tts_indextts.py（本机部署的 Index-TTS，零样本克隆参考音）。
//      engine='indextts' 时 voice 是**参考音频的别名或路径**（不是 Kokoro 的音色名），speed 映射到
//      Index-TTS 的 duration_factor = 1/speed。没写 engine 的语言（如 en）行为完全不变。
//
// 加一种语言 = 在 LANGS 里加一条；页面、影片模块、内容文件都不用改代码。
// 内容文件负责「这一版说什么话」：title / series / plate_no / details[].name|note / caption /
// signature / end.* / voice.lines[].text，以及 stations{ 站点键 → 译名 }（站点键是语言无关的锚点）。

export const LANGS = {
  en: {
    id: 'en', name: 'English',
    css: null,                                    // 拉丁字体已在风格自己的 fonts.css 里
    fonts: { roman: 'Bodoni Moda', script: 'Pinyon Script' },
    // 逐字字距（传给 engraveText / writeScript 的 track）：拉丁大写需要拉开，汉字天然紧排
    track: { title: 0.16, latin: 0, plateNo: 0.12, series: 0.22, figName: 0.06, station: 0.12, endTitle: 0.12, credit: 0.03 },
    labelPrefix: 'FIG.',                          // 圆窗编号前缀 → `FIG. 1  ·  THE FLOWER`
    cps: 14,                                      // 没有配音时长表时的兜底朗读速度：每秒几个字（拉丁）
    tts: { lang: 'en-gb', voice: 'bm_fable', speed: 0.92 },
  },
  zh: {
    id: 'zh', name: '中文',
    css: '/core/lang/fonts-zh.css',
    // ★ 罗马体角色必须是**字体栈**：`"Bodoni Moda"` 在前、中文字体在后。
    //   子集里含可打印 ASCII，如果只写 `"Noto Serif SC"`，拉丁字母与数字会被中文字体抢走
    //   （标题里的 `Coffea arabica`、图例里的 `1400—1900`、署名里的 `Lemo` 都会变形）。
    //   写成栈之后：Bodoni 有字形就用 Bodoni，缺字（汉字）才落到中文字体。
    fonts: { roman: '"Bodoni Moda", "Noto Serif SC"', script: '"LXGW WenKai"', latin: 'Bodoni Moda' },
    track: { title: 0.30, latin: 0, plateNo: 0.10, series: 0.16, figName: 0.10, station: 0.08, endTitle: 0.10, credit: 0.04 },
    labelPrefix: '图',                             // → `图 1  ·  花`
    cps: 4.5,                                     // 汉字一个字一个音节，比拉丁慢得多（同 core/README.md 的 --cjk-cps）
    // 中文改走本机 Index-TTS（core/tts/tts_indextts.py）：零样本克隆参考音，音色比离线 Kokoro 正规得多。
    // voice 是**参考音别名**（见 tts_indextts.py 的 VOICE_ALIASES），不是 Kokoro 的音色名；
    // speed=1.0 → duration_factor=1，实测 9 条真实台词 4.0–4.9 字/秒，正好对上上面的 cps。
    tts: { engine: 'indextts', lang: 'cmn', voice: 'zh_curator', speed: 1.0 },
  },
};

const DEFAULT = LANGS.en;

// C.lang 取语言：'zh' / 'zh-CN' / 'ZH' 都归到 zh；缺省、空串、未知语言一律回退 en。
//
// ★ 两层结构：core/lang 提供**默认**（每种语言一套通用字体），**内容文件可以覆盖**。
//   这样「共享目录里放的是通用默认」与「字体是风格自选资产」两件事不冲突：
//   - 默认：`core/lang/fonts-zh.css` = 思源宋（罗马体角色）+ 霞鹜文楷（手写体角色）。
//     这两张是**通用**的中文衬线/楷体，对衬线风格合理，对无衬线风格不合适。
//   - 覆盖：某个风格要换自己的中文字体时，在自己的 content 里写
//       "fonts": { "roman": "\"My Sans\", \"Noto Sans SC\"", "script": "\"My Kai\"" }
//     并在它的 index.html 里挂自己的字体表 —— 无需改本文件。
//   （本文件是「加一种语言」的入口；「某个风格换一种字体」的入口在内容文件。）
export function langOf(C) {
  const raw = C && typeof C.lang === 'string' ? C.lang.trim().toLowerCase() : '';
  const base = !raw ? DEFAULT : (LANGS[raw] || LANGS[raw.split('-')[0]] || DEFAULT);
  if (C && C.fonts && typeof C.fonts === 'object') {
    return { ...base, fonts: { ...base.fonts, ...C.fonts } };
  }
  return base;
}

// 每个字族要预载的字重/字形：罗马体要正体 + 斜体（学名、题注是斜体），手写体只有正体。
// 按 roman → script → latin 的顺序去重，所以 en 拿到的正是改动前那三行，一个不多一个不少。
const FACE_LOADS = {
  roman: ['600 40px %F%', 'italic 400 40px %F%'],
  script: ['400 40px %F%'],
  latin: ['600 40px %F%', 'italic 400 40px %F%'],
};
// 和 plate.js 的 fontSpec 同一套规矩：裸字族名补引号，已经带引号/逗号的字体栈原样放行。
// 不补引号其实也合法（CSS 里 `Bodoni Moda` 是一串标识符、仍指同一个字族），
// 但补上之后 en 拿到的字串与改动前那三行**逐字符相同**，回归就不用靠推理。
const famSpec = f => /[,"']/.test(f) ? f : `"${f}"`;
export function fontsToLoad(L) {
  const f = (L && L.fonts) || {};
  const out = [];
  for (const role of ['roman', 'script', 'latin']) {
    const fam = f[role]; if (!fam) continue;
    for (const t of FACE_LOADS[role]) { const s = t.replace('%F%', famSpec(fam)); if (!out.includes(s)) out.push(s); }
  }
  return out;
}

// 有没有汉字（含全角标点）。给需要判断「这段文字该走中文字族还是拉丁字族」的地方用。
const CJK = /[\u2e80-\u303f\u3040-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;
export function isCJK(s) { return CJK.test(String(s == null ? '' : s)); }
