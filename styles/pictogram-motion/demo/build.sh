#!/bin/sh
# pictogram-motion · 象形动效 —— 本 demo 完整链（cwd = 仓库根；步骤与 DEMO.md「Build notes」一致）。
#
# ★ 本文件对编排器（lemo-tools/lemo-make.mjs）有一处**声明**作用，务必保留：
#   渲染行 `node core/render/video.mjs $D … --q lang=ej …`。
#   编排器只从 build.sh 里读这一行的 --q（qIntent，lemo-make.mjs:1137-1155），**取不到就一个页面参数都不传**。
#   ⇒ 对本片 `--q lang=ej` **不是可选参数，是形态开关**：随库成片 pictogram-motion.mp4 是 **EN-JP 版**
#     （DEMO.md:5 头部即标「EN-JP version」；demo/mux.sh:4,8 的 OUTDIR=out_ej 也是默认）。
#     语言开关在 demo/scenes.js:6
#       `const EJ = new URLSearchParams(location.search).get('lang') === 'ej'`
#     —— **没有这个参数 ⇒ EJ=false ⇒ 渲成中文（ZH）版**，与 shipped 不是同一部片子。
#   该参在本 demo 自带的 render.mjs 里由 `LANGQ=ej`（默认）转成 `?lang=ej`（render.mjs:20-22），
#   ★ 但编排器**不跑 demo 自带的 render.mjs**（它只把 risograph 的 tools/video_png.mjs 当替换渲染器，
#     见 lemo-make.mjs:1484-1486）—— 它用 core/render/video.mjs 打同一个 index.html。
#   所以这条 --q 是编排器唯一能知道「要 EN-JP」的地方。
#
# ★ 为什么渲染走 core/render/video.mjs（而不是 demo 自带的 render.mjs）：
#   index.html 是**渲染器无关**的（只暴露 window.render(t) / window.DUR / window.READY，index.html:61-66），
#   core/render/video.mjs 与 render.mjs 打的是同一张页面、同一个 `?lang=ej` ⇒ 同一画面；
#   而编排器**只**走 core/render/video.mjs ⇒ 本脚本与编排器同一条路、产物名也对得上。
#   （demo 自带的 render.mjs 仍可用：它按 worker 分段写 out_ej/seg_*.mp4 再交给自带的 ./mux.sh，
#     那是 DEMO.md「Build notes」4a 的写法，与本脚本等价，只是不经过编排器的中间片契约。）
#
# ★ 音频三步为什么只有一行 mix.py：`demo/mix.py` 是本 demo 给编排器准备的**薄壳**，它按 DEMO.md
#   「Build notes」1–2 步的顺序跑 ① node music/export_timeline.cjs ② music/music.py，
#   再做交付口径的真峰值收口（4× 过采样限幅到 −6.5 dBFS），产物落在编排器契约位置 demo/mix.wav
#   （编排器的混音步调的正是它，lemo-make.mjs 的混音候选 mix.py）。
#
# ★ 混流为什么用 core/render/mux.sh（不是 demo 自带的 ./mux.sh）：后者是 zsh、只吃一个输出路径
#   （自成一体的「拼段 + 混音」接口），编排器按 `A="$2"` 签名探测 ⇒ 认不出它、回退 core 版
#   （lemo-make.mjs:1492-1500）。本脚本与编排器保持同一条混流路径。
#   fps 60 / grain 4 与 DEMO.md 及 demo/mux.sh 的 `noise=c0s=4:c0f=t+u` 一致。
set -e
D=styles/pictogram-motion/demo
PY=.venv/bin/python
FPS=60

# 1–3. 音频：剪辑表 → 配乐母带 → 交付电平收口 → $D/mix.wav（DEMO.md:140-144 的第 1–2 步 + 交付收口）
$PY $D/mix.py
grep -q "shots pass" $D/music/report.txt      # 自检：79/79（DEMO.md:145）

# 4. 渲染 EN-JP 版：163.6 s @ 60 fps（DEMO.md:152-154）
#    ★ --q lang=ej 是形态开关，不是可选参数（见文件头）。
node core/render/video.mjs $D --fps $FPS --workers 6 --q lang=ej --out $D/out/video_gpu.mp4

# 5. 混流：第 4 参 = fps 60，第 5 参 = grain 4（DEMO.md:96 与 mux.sh 的 `noise=c0s=4`）
#    ★ 60 与 4 写**字面量**：编排器 muxIntent() 只认 mux.sh 行尾的纯数字（lemo-make.mjs:1088-1098），
#      写成 "$FPS" 会让它取不到颗粒 ⇒ 退回 mux 脚本默认 2，与 shipped 的 grain 4 不符。
V=$D/out/video_gpu.mp4
A=$D/mix.wav
O=styles/pictogram-motion/pictogram-motion.mp4
sh core/render/mux.sh "$V" "$A" "$O" 60 4

# 6. 字卡字幕（无旁白，只有标题字卡轨）→ styles/pictogram-motion/pictogram-motion.srt（DEMO.md:163-164）
node $D/srt.cjs
