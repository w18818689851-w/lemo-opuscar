# 43 个内置风格的画面技法目录

> 目的：为「自定义文案 → 出片」找出**可复用的画面技法**。
> 方法：只读分析 `styles/<slug>/demo/**` 的绘图代码（`film.js` / `main.js` / `engine/*` / `src/*`），
> `STYLE.md` 只作辅助解释。所有 `文件:行号` 均已逐字核对。
> **路径写法约定**：为紧凑起见，本文多数引用省略了前缀，写成 `风格名/相对路径:行号`；
> 其完整路径为 `styles/风格名/demo/相对路径`。例：`engraving/film.js:305` = `styles/engraving/demo/film.js:305`；
> `engraving/engine/burin.js` = `styles/engraving/demo/engine/burin.js`。
> 单个风格的小节里，若该条已写明风格名，则后续裸写的 `film.js:344` / `engine/plate.js:19` 等均指该风格的 `demo/` 下同名文件。
> `core/**` 与 `lib/**`（属 `D:/lemo-tools`）、`STYLE.md` 的引用本身即完整路径，未省略。
> 结论先行：**这些风格不是「模板套用」，而是 43 段手写的 Canvas2D / WebGL 绘图程序**——
> 技法在**代码**里，不在数据里。这决定了复刻路径（见文末）。

---

## 0. 先看清底座：所有风格共用什么

| 共享层 | 位置 | 内容 | 是否含视觉参数 |
|---|---|---|---|
| 数学与缓动 | `core/lib.js`（44 行） | `clamp/lerp/seg/ss/eio/eo/ei/back/spring/mulberry(seed)/hash/vnoise/TAU/monotone/track/env` | **无**，纯数学 |
| 共享字体栈 | `core/fonts/fonts.css` | ZCOOL KuaiLe / Fredoka 等 | 仅部分风格使用 |
| 3D 后期 | `core/three/post.js` | three.js 后期 | — |
| 渲染与出片 | `core/render/{page.mjs,video.mjs,serve.mjs,size.mjs,...}` | 页面装载 → 逐帧截图 → ffmpeg | — |
| 中文语言字体 | `core/lang/fonts-zh.css` | 被 `index.html` 引入 | — |

**每个风格的视觉参数都在它自己的 `demo/` 里**：配色常量、字体（`demo/fonts/fonts.css`）、
绘图原语（`demo/engine/*` 或散在各模块）、字幕画法。**跨风格零共享视觉参数**——
唯一例外是 26 个风格 import 了 `core/lib.js` 的缓动/随机函数（这属于「动效数学」，不是「动效参数」）。

---

## 1. 技法分类清单（按类归纳，非按风格罗列）

### ① 底材 / 纸纹（**最高频的共性**）
「世界空间纹理 + 一次性预渲染到离屏 canvas」是跨风格复用的核心套路。
- `engraving`：`engine/plate.js:19-24` `paperTexture(W,H,seed=53)`——3 个八度的 `noise2` 叠出帘纹/纤维/霉斑，带缓存 `paperCache`；成品以 `multiply` 压回画面（`film.js:344` 附近）。
- `paper-lantern`：`src/paper.js:73` `x.createPattern(GRAIN,'repeat')` + `grainA:0.9`。
- 同类：`ukiyoe`（木版纸）、`watercolor`（`engine.js:40 PAPER='#f1e9da'`）、`woodcut`（`PAPER='#EFE8D8'`）、`papercut-red`（宣纸 `rice:'#f2e8d0'`）、`spy-titles`、`silkscreen-poster`、`midcentury-toon`、`crayon-book`（`PAL.paper`）。
- **可复用度：高**。这一层是「参数化纹理」，与画什么内容无关。

### ② 具名调色板常量（**第二大共性**）
绝大多数风格把配色写成**一个具名对象**，命名语义统一（`paper/ink/bg/surf/accent/...`）：
- `engraving/engine/plate.js:7` `PAL = { paper, plateTone, ink, inkSoft, foxing, bevelDark, bevelLight }`
- `swiss-motion/film.js:6` `C = { page, paper, ink, red, grid, pgrid, mute, wall }`
- `midcentury-toon/engine/toon.js:10` `PAL`（35 色，含 `paperD/paperDD` 明暗阶）
- 多阶色系：`iso-infographic/engine.js:27`（每色 3 阶）、`pictogram-motion/engine.js:45`（命名色系 + 5 阶渐变）、`hd-2d/chars.js:8`（`ramp()` 生成 4–5 阶）、`watercolor/plants.js:12`（每植物一色阶数组）
- 统计：43 个风格中 **24 个**有可 `grep` 到的具名调色板常量（详见 `lib/dub-visual.json`）。
- **可复用度：高**。这是唯一「已经是数据」的一层。

### ③ 程序化笔画 / 笔触（**风格辨识度的真正来源**）
每种媒介的「笔」都是自己写的：
- `engraving/engine/burin.js`：雕刻引擎——排线三族按色调阈值依次开启、**鼓胀律** `width × (0.2+0.8·sin(πu)^0.7)`。
- `crayon-book/crayon.js:37`：`{ w, p, seed, wob, boil }`——蜡笔的抖动（wob）与「沸腾」重画（boil）。
- `ink-wash`（19 个模块，`ink.js/wave.js/face.js`）：墨的晕开与飞白。
- `one-line`：一笔画路径 + `globalCompositeOperation` 遮罩（`hands.js:47 source-in`）。
- `watercolor/engine.js`：笔刷 + 湿边。
- **可复用度：低**。每条笔触是媒介特有的物理模拟，换风格即作废。

### ④ 图形语言（形状系统）
- `pixel-rpg`：全部形状走像素网格（`px.js`），**字体也是自绘点阵**（`font.js`：大写高 7 / x 高 5 / 行高 10，用 `'#'`/`'.'` 定义字形）。
- `brick-toy`：乐高件几何（`bricks.js` + `COL` 色表）。
- `lowpoly-island` / `tilt-shift` / `glass-product` / `backrooms` / `paper-lantern` / `hd-2d` / `paper-popup`：走 **three.js / WebGL**（共 8 个风格用 `THREE.`）。
- `risograph/riso.js`、`ascii-crt/crt.js`、`woodcut/engine/print.js`：**裸 WebGL 着色器**（专色叠印 / CRT 曲面 / 印刷）。
- **可复用度：低**（几何与内容强耦合）。

### ⑤ 字体与排版
- 每风格自带 `demo/fonts/fonts.css` + `@font-face`（字体名不共享）。41/43 有明确字体族；`pixel-rpg` 与 `whiteboard` 特殊（自绘点阵 / 手写笔迹 JSON）。
- 排版是**风格的一部分**：`swiss-motion/film.js:40-42` 的 `font(g,weight,size,fam='Archivo')` 在大字号自动加负字距；`film.js:71-80` 的 `TX` 表把每行文字定义成「A 混乱 → B 统一 → C 压缩 → D 齐左 → E 最终」的状态机。
- **可复用度：中**。字体文件可直接复用；排版规则要逐风格读。

### ⑥ 字幕画法（**每个风格都不一样，且都不是「底部白字」**）
- `engraving/film.js:305-317` `drawSubs()`：手写体（Pinyon Script）写在**一张撕边纸签**上（用 `RNG(7)` 抖动出毛边），底部居中，`y1=1058*fy`。
- `hologram-hud/engine/hud.js:297` `subtitle()`：**暗色板 + 角括号 + 声纹条**（HUD 风格）。
- `silkscreen-poster/STYLE.md:49`：「海报文字即字幕」，是一条印刷色带。
- `stained-glass/subs.js:18`：字幕写在**彩绘玻璃条**上（渐变玻璃 + 铅条端点）。
- `pixel-rpg`：点阵字体打印；`ascii-crt`：终端字符。
- **可复用度：中低**。这正是「文案出片」最需要、却最需要逐风格重写的一层。

### ⑦ 转场（都不是 ffmpeg 的淡入淡出）
- `engraving`：**揭纸**——印张从铜面上掀开（`film.js:351` 注释 + `drawPeel`）。
- `hologram-hud`：**扫描面**（`film.js:176` `drawScanPlane`，扫描进入 / 擦除）。
- `silkscreen-poster`：**刮板拉开**（`engine/silk.js` squeegee 前沿 + 拖尾）。
- `woodcut`：**压印**（`engine/print.js`）。
- **可复用度：低**（每个转场是该媒介的动作，且与镜头/时间表耦合）。

### ⑧ 动效（缓动 + 时间表）
- 缓动来自 `core/lib.js`（26 个风格 import，如 `engraving/film.js:12 { clamp,eio,eo,ss }`）。
- `swiss-motion` 自建 `demo/ease.js`（`E/snap/lin/steps/track/E8/E16/BEAT/BAR`）——**节拍网格驱动**。
- 时间表是显式的：`engraving` 用 `BEAT=0.625`（96 BPM 网格，`film.js:21`）；`swiss-motion/film.js:19` 有 `T` 表。
- **可复用度：中高**。缓动函数可复用；时间表要重写。

### ⑨ 噪点 / 颗粒 / 网点（**跨媒介高频**）
- 关键词命中数：`midcentury-toon` 97、`ukiyoe` 39、`ink-wash` 32、`microgame` 28、`silent-film` 25、`paper-lantern` 22。
- `risograph`：专色 multiply 叠印 + **各自网角**的半调 + 套色错位（`riso.js` 头部注释）。
- `silkscreen-poster`：套色错位 1–3px + 过印鬼影（`silk.js:184-192` 由底墨 `mix()` 出亮/暗边）。
- **可复用度：高**。`--grain` 已存在于出片链（`core/render/mux.sh` 末参），是现成的叠加层。

### ⑩ 光效 / 暗角
- 暗角（`radialGradient`）命中：`art-deco` 45、`dark-keynote` 16、`silent-film` 10、`woodcut` 9、`paper-lantern` 9、`paper-popup` 9。
- `engraving/film.js:344`：径向渐变以 `multiply` 压出暖暗角。
- `ascii-crt/crt.js:90`：`glow/halo/beam/flick/expo` 一组 CRT 光参数。
- **可复用度：高**（纯叠加层，ffmpeg 也能做）。

### ⑪ 镜头运动
- 全部是**程序化镜头**，不是剪辑：`engraving/film.js:181` 的 `camAt(t)`（`film.js:340` 每帧调用）；`hologram-hud` 的 `cam` 跟随目标框。
- **可复用度：低**。

---

## 2. 共性 vs 独一份

**反复出现、最值得复用（4 类）**：
1. **纸/底材纹理**（一次性预渲染 + multiply 压回）
2. **具名调色板常量**（24/43，命名语义统一）
3. **颗粒/网点/套色错位**（≥12 个风格，且已是叠加层形态）
4. **缓动 + 显式节拍时间表**（26 个风格共用 `core/lib.js` 缓动）

**独一份、无法跨风格复用（举例）**：
- `engraving/engine/burin.js` 雕刻引擎 · `risograph/riso.js` WebGL 专色叠印 · `ascii-crt/crt.js` CRT 着色器 · `woodcut/engine/print.js` WebGL 印刷 · `pixel-rpg/font.js` 自绘点阵字体 · `swiss-motion/ease.js` + 排版状态机 · `silkscreen-poster/engine/silk.js` 丝网刮板 · `hologram-hud` 的 `theme(hue,accent)` 参数化配色（`engine/hud.js:11`）。

---

## 3. 文案出片走哪条路：路 A（ffmpeg 合成）vs 路 B（Canvas2D 真画）

### 路 A 能还原几成？——**约一到两成的「氛围」，还原不了「技法」**
ffmpeg 能拿到的只有 `lib/dub-visual.json` 里的 `palette` / `typography` / 纹理叠加 / 暗角 / 字幕样式。
- 现状证据：`dub.mjs:390-393` 的形态 A 背景就是一条 `gradients` 滤镜（`c0=0x0C1016:c1=0x18222D:c2=0x101720`）；字幕样式硬编码在 `lib/dub-core.mjs:254-277`。
- 天花板证据：每个风格的画面是 `render(ctx, t)` **逐帧画几百个图元**。以 `engraving/film.js:208-378` 为例，一帧里包含铜版场景、雕刻排线、圆形放大图、引线避让、手工上色、揭纸转场、暖暗角——**ffmpeg 滤镜图没有对应算子**。
- 结论：路 A 能得到「**色偏 + 字体 + 颗粒 + 暗角**」这层外壳（即「像某个时代/媒介的调子」），**得不到**笔触、图形语言、转场、镜头。对 `swiss-motion` / `whiteboard` 这类**画面即排版**的风格，路 A 的还原度会显著高于平均；对 `engraving` / `ukiyoe` / `woodcut` 这类**画面即手绘主体**的风格，路 A 几乎等于换了个滤镜。

### 路 B 的接入点与代价
**接入点已存在、且被全部 43 个风格在用**：
- `core/render/page.mjs:60-64` `openDemo()`：`chromium.launch()` + `browser.newPage({viewport:{width:w,height:h}})`，装载 `index.html`。
- `core/render/video.mjs:66-67`：`await page.evaluate(t => window.render(t), f/FPS)` → `await page.screenshot({type:'jpeg',quality:95})` → 管道喂 ffmpeg。
- 页面契约（`styles/engraving/demo/index.html:6-7`）：`<canvas id="c" width="1920" height="1080">` + `<script type="module" src="main.js">`，并暴露 `window.render(t)` / `window.DUR` / `window.READY`。
- 外围（静态服务 `serve.mjs`、尺寸 `size.mjs`、分段与锁 `video.mjs:20-40`、拼接）**全部现成**，加一个风格 = 加一个 `demo/` 目录。

**代价**：
- 要**新写一段 `render(t)` 程序**。技法在代码里，所以「复刻某风格」= 重写该风格的绘图逻辑，**不是填参数**。
- 字体要随片带（`demo/fonts/fonts.css` + `@font-face`），渲染走 headless chromium。
- 43 个风格全量复刻 = 43 段绘图程序，成本与原始创作同量级。

### 判断（基于代码，不给观点）
- **纯路 A 不可行**：它只能改「调子」，不能改「技法」，而 43 个风格的辨识度全在技法层。
- **纯路 B 代价过高**：等于把 43 部片重写一遍。
- **可行的是按「文案友好度」分层**，判据来自代码本身——**画面是「排版」还是「画出来的主体」**：
  - **文案即画面（路 B 成本低，优先做）**：`swiss-motion`（`film.js:29` `LAYOUT` + `:30 setLines()`，整部片就是排版状态机）、`whiteboard`（`film.js` 手写体 44px AD）、`ascii-crt`（`term.js` 逐字打印）、`dark-keynote`、`dataviz`、`iso-infographic`、`pictogram-motion`。这类风格的 `render(t)` 本来就吃「文字行」当输入，**换一段文案 ≈ 换 `LINES` 数组**。
  - **画面是画出来的主体（路 A 或不做）**：`engraving`（`subjects/bee.js`）、`ukiyoe`、`woodcut`、`ink-wash`、`crayon-book`、`papercut-red`、`shadow-puppet`、`lowpoly-island`、`tilt-shift`、`glass-product`、`brick-toy`、`hd-2d`、`paper-lantern`、`paper-popup`、`backrooms`。它们的主体是**手工建模/手绘的**（如 `engraving/demo/subjects/` 下的 `bee.js`/`scallop.js`），任意文案没有对应主体，**只能出路 A 的「氛围版」**。

---

## 4. 机读产物

配色 / 纹理 / 动效 / 排版已结构化到 **`D:/lemo-tools/lib/dub-visual.json`**：
43 个风格全部 `hasVisual:true`（每个都找到绘图代码与可核对的视觉参数）。
- **`palette` 里的每一个 hex 都能在它自己的 `sourceFiles` 里逐字找到**（已用脚本核对，145 个 hex，0 处失配）；
- 找不到硬编码颜色的，**填 `null` 并在 `evidence` 里说明**，不猜：
  - 程序化配色（hex 不是可取值）：`hologram-hud`（`theme(hue,accent)` 参数）、`risograph`（RGB 数组）、`blueprint`（WebGL 着色器 `vec3`，hex 只在注释里）；
  - 内容驱动：`silkscreen-poster`（`C.palette[key]` 来自 `content.json`，代码内无默认纸色）；
  - 颜色分散内联、未成调色板：`backrooms` / `living-screencast` / `microgame` / `one-line` / `cel-anime-80s`（`fg` 无硬编码值）。
每个字段都带 `evidence`（`文件:行号` + 原文摘录），可逐条抽查。

## 5. 路 B 实测：真换文案跑了一次（`creative/dub-probe/`）

> 上文 §3 的「文案友好度」当时是**读代码的判断**。这里补上**实测证据**。
> 探针目录 `creative/dub-probe/`：**只读引用** `/styles/swiss-motion/demo/*`，不修改该风格任何文件。
> 页面契约与 `core/render/page.mjs` 一致（`window.render(t)` / `DUR` / `READY`）。

**结论：路 B 成立。** 用现成风格 `swiss-motion` 的绘图程序 + 一段自定义文案，直接渲染出片：
- 命令：`node core/render/still.mjs creative/dub-probe --range 20:30:0.25 --out ...`
- 产物：`out-en/`（英文自定义文案 5 帧）、`out-zh/`（中文自定义文案 3 帧）、`custom-copy-swiss-motion.mp4`（10s，WSL ffmpeg 编码）
- 画面上出现了自定义文案（小字导语 `Step` + 大字序号 + 版面网格照常运转），**排版/网格/乐谱联动等编排手法全部复用**。

**但实测同时暴露 3 个「换文案不是免费的」的硬约束**（这才是知识库要沉淀的「编排手法」）：

1. **一个风格的文案可能有多个来源，且部分不可注入。**
   `setLines()` 只驱动「小字导语 + 大字序号 + 字幕」；而海报正文（`neue musik` / `konzert 1961` / `freitag 17. märz 1961` …）来自
   `styles/swiss-motion/demo/film.js:71-80` 的模块级 `const TX = [...]`，**既无 setter 也无 export**（`film.js` 全部导出里没有它）。
   → 实测帧 `out-en/en_16.6.jpg` 里，导语已是自定义文案，海报正文仍是原片德文。**换文案必须逐个找出「文案驻留点」，有些在数据文件里，有些硬编码在影片程序里。**

2. **文案要满足该风格的文本契约。**
   `setLines()` 用 `text.indexOf('. ')` 切「小字/大字」（`film.js:32-33`）。中文句号 `。` 不匹配 →
   `i = -1` → `small = slice(0,0) = ''`、`big = slice(1)`，**首字被吞**。
   实测帧 `out-zh/zh_4.6.jpg`：输入「第一，先给结论。」渲染成「**一**，先给结论。」——「第」丢失。

3. **字体覆盖决定「风格特质」能否保住。**
   该风格字体栈只有 Archivo / DMSerif / Fraktur（拉丁）。中文仍能显示，但走的是**系统回退字体**——
   排版能跑通，**该风格的字形特质丢失**。要真正「对齐风格特质」，必须像 `engraving` 那样有 CJK 字面（`engine/plate.js:12-15` 的 `setFonts()` 可换中文字体），或给每个风格配 CJK 配对字体。

**并且：能不能注入文案，是「该风格的 film 模块有没有把文案做成参数」，不是风格类别。**
对 7 个「画面即排版」候选实测（有无 `set*` 文案注入 API）：

| 风格 | 文案注入 API | 外部文案文件 | 硬编码文案行数 |
|---|---|---|---|
| `swiss-motion` | `setLines` / `setScore` / `setWords` | `lines.json` | 18 |
| `dark-keynote` | `setLines` / `setAccent` | 无 | 36 |
| `dataviz` | `setData` / `setType` / `setCaptions` | `lines.json` | 5 |
| `whiteboard` | **无** | `lines.json` | 6 |
| `ascii-crt` | **无** | `lines.json` | 7 |
| `iso-infographic` | **无** | 无 | 11 |
| `pictogram-motion` | **无** | 无 | 66 |

→ 7 个里只有 **3 个**（swiss-motion / dark-keynote / dataviz）暴露了文案注入点；其余 4 个即使读了 `lines.json`，
也**只能靠替换文件或改 `main.js` 接线**，没有 API 可调。**「复用现成风格」的真实门槛在这里。**

## 6. 「可选注入钩子」实测：`window.__COPY__` 到底能不能加（真跑）

设想（不破坏原有行为的加法）：把写死的文案常量改成「优先读可选全局，没给就退回原件」。

对 `swiss-motion` 的**海报文字** `TX` 试了一遍（`styles/` 未改动，钩子跑在副本 `creative/dub-probe/film-hooked.js` 上）：

```
film.js:71  const TX = [ ... ];                    →  const TX0 = [ ... ];
film.js:83  （插入）const TX = (typeof window !== 'undefined' && window.__COPY__) || TX0;
```

**改动量：改 1 行 + 加 1 行。**（实验副本另需把 `'./ease.js'` 改成绝对路径，就地改则不必。）

四格对照（`node core/render/still.mjs creative/dub-probe/hook 9.0 13.0 21.0 27.5 41.0 --q 'hook=?&copy=?'`）：

| 组 | hook | `window.__COPY__` | 与基线 A 的关系 |
|---|---|---|---|
| A | 0 | 未设 | 基线 |
| B | 1 | 未设 | **5/5 帧 md5 逐字节相同** |
| C | 0 | 已设 | **5/5 帧 md5 逐字节相同**（原件不读该全局） |
| D | 1 | 已设 | 5/5 帧不同：海报文字 `neue musik` → `neue form`，其余画面逐像素一致 |

→ **逐帧一致性成立**（B 组证明：钩子在场但不触发时，输出与原件逐字节相同）；
C 组排除了「差异其实来自全局变量本身」的可能。**结论：对 swiss-motion 这类风格，这个加法是可行的、且零回归。**

**但真正的代价不在行数，而在载荷契约。** `__COPY__` 必须是 `TX` 形状 —— 10 条 ×
`A[文本,字体族,字重,字号,y] / B[文本,字重,字号] / C[字号,字重,y] / E[x,y,字号,字重] / split / cut`，
字体与坐标是按德文海报**手工调过**的。灌一个「纯文案数组」进去会当场排版错乱；
要通用化，得在**调用方**另做一层「按既有版式自动缩放/换行」的适配（海报宽 `PW=706`）。

另注：`swiss-motion` 本身**已有** `setLines` / `setWords` 可换字幕，海报 `TX` 只是**第二条**文字通道 ——
它属于 B 类（有注入 API、字体无 CJK 字面），不是 C 类。

## 7. 四字段跑遍 43 个 + 分类（`dub-visual.json` v1.1）

每条风格新增 `copySources` / `copyContract` / `copyInjection` / `fontCoverage` / `routeClass`：

- **文案源**：43/43 有。运行时**读 JSON** 的 18 个（`lines.json` 13 + `content.json` 4 + `script.json` 1）；
  其余 25 个文案**内联在源码常量里**（`story.js` 的 `VO` / `LINES` 最常见，另有 `edl.js`、`cardspecs.js`、
  `index.html` 内联、`scene.js`）。⚠️ 注意：**33 个风格目录里有 `lines.json`，但只有 13 个在运行时读它** ——
  其余 20 个的 `lines.json` 是**配音流水线的输入产物**，不是画面文案源。
- **文案契约**：33 个可从 `lines.json` 实读（`lineIds` 集合 / 条数 / 最长字数）；10 个只能从内联源计数。
  分隔符五花八门：`split(' ')`、`split('.')`、`indexOf('. ')`、`split(',')`、`split('·')`、`split('\n')`、
  `split('@')`、`split(/[\\s,]+/)`，还有 12 个风格**完全不切分**。
- **注入 API**：`setter` 7 个 / `data-file`（无 setter，但运行时 fetch 文案 JSON，换文件即可）12 个 /
  `inline-code`（既无 setter 也无 fetch，只能改文件）24 个。
- **CJK 字面**：`fc-query %{charset}` 实测，**有 CJK 的 11 个**（`game-show` 221 万码位、`pictogram-motion` 41 万、
  `paper-lantern` 27 万、`ukiyoe` 4.9 万、`ink-wash` 1.35 万、`cel-anime-80s` 7766、`papercut-red`/`shadow-puppet` 6763、
  `watercolor` 2493、`paper-popup` 194、`halftone-dossier` 221 万），**其余 32 个为 0**。

**A/B/C 分类结果（按「有无 setter」× 「字体有无 CJK 字面」交叉）：**

| 类 | 定义 | 数量 | 名单 |
|---|---|---|---|
| **A** | 有注入 API **且** 有 CJK 字面 | **0** | —— |
| **B** | 有注入 API、无 CJK 字面 | **7** | blueprint, dark-keynote, dataviz, microgame, risograph, spy-titles, swiss-motion |
| **C** | 无注入 API | **36** | 其余全部（其中 12 个可换 JSON 文件、24 个只能改源码） |

→ **A 是空集**：7 个有 setter 的风格字体里一个 CJK 字面都没有；11 个有 CJK 字面的风格一个 setter 都没有。
**这意味着「现成风格 + 中文文案 + 不改代码」在 43 个里一个都不成立** —— 中文出片必然要么补字面（B 类 7 个），
要么改文件/加钩子（C 类 36 个）。这是本次最硬的一条结论。

## 8. 本目录没查清的点
- **转场**：只逐字确认了 4 个风格（engraving 揭纸 / hologram-hud 扫描面 / silkscreen-poster 刮板 / woodcut 压印）；其余风格的转场机制未逐个读，`dub-visual.json` 里对应字段填了 `null`。
- **镜头运动**：只确认了 `engraving`（`camAt`）与 `hologram-hud` 的跟随逻辑，未覆盖全部 43 个。
- **`halftone-dossier`**：绘图内联在 `index.html`（1087 行，SVG），未逐行读完，只取了调色板与字体行。
- **路 B 实测只跑了 1 个风格**（`swiss-motion`）。其余 42 个未实测；「文案注入 API」表是 `grep` 出来的（有无 `export set*`），未逐个真跑验证。
- 探针**未接 TTS 与配乐**：`dur` / `words` 是按字数合成的近似值，`score.json` 直接复用了原片；真实链路里这两项来自 `core/tts` 与 `music/`。

§7 四字段的**取证方式与残留不确定**（如实标注）：

- `copySources` / `copyInjection` = **grep 实测 + 人工核对 file:line**（扫了全部 `styles/*/demo/**/*.js` 的
  `fetch(` / `export set*` / `import` / 内联常量），**未逐个真跑**。只有 `swiss-motion` 是**真跑**验证过的。
- `fontCoverage` = **真跑**：WSL `fc-query` 读每个字体文件的 `%{charset}`，与 CJK 三段码位区间求交。
  `halftone-dossier`（393 个字体文件）与 `game-show`（396 个）是 Noto CJK **分片** woff2，
  「有 CJK」的判定来自分片并集；`paper-popup` 只命中 194 码位、`watercolor` 2493 —— 这些**覆盖率很低**，
  实际能否排出常用汉字未验证（只有 `paper-lantern` 27 万 / `pictogram-motion` 41 万 / `game-show` 221 万
  是真正够用的量级）。
- **`urban-sketch`**：`subs.json`（3 条字幕）在代码里**找不到 `fetch`**，疑似构建产物或由外部读取，
  未查清；`copyContract.source` 已按 `inline` 记录并留了说明。
- **`impasto`**：没有字幕系统，只有标题卡（`scenes/cards.js`）与 DOM credits（`film.js:37`）。
- **C 类 36 个未逐个评估钩子代价**：只对 `swiss-motion` 做了真跑；`halftone-dossier` / `game-show` 的文案
  内联在 `index.html`、`pictogram-motion` 在 `edl.js` 的三语 `card()` 里，钩子形态要各自另议，不能照搬。
- **`copyContract.maxTextChars`** 是「该风格自带样例文案的最长值」，**不是渲染上限** ——
  真正上限由各风格的排版代码决定（如 swiss-motion 海报宽 `PW=706`），本次未逐风格推导。

