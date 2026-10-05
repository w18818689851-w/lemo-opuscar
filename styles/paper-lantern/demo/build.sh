#!/bin/sh
# paper-lantern · 纸雕灯影 —— 本 demo 完整链（cwd = 仓库根；与 DEMO.md「Build notes」一致）。
#
# ★ 本文件对编排器（lemo-tools/lemo-make.mjs）有一处**声明**作用，务必保留：
#   渲染行 `node core/render/video.mjs $D … --q "content=script.json"`。
#   编排器只从 build.sh 里读这一行的 --q（qIntent），而 content= 是它唯一会「整条链同源」的值：
#   它据此判定本片「画面与配音同源」⇒ 把配音**前置**到渲染之前跑。
#   这一步对本片是**必需**的：本片配音是 Index-TTS（常驻 7.5 GB / 显卡共 8.19 GB），
#   而编排器的渲染是 6-worker 的 GPU 渲染 —— 两者并发会因显存溢出把 Index-TTS 卡死
#   （实测：并发时 tts_indextts.py 内层 5 分钟零进展被看门狗中断；单独跑音频链则正常）。
#   配音前置后，Index-TTS 独占显卡；随后 mix.py（纯 CPU）才与渲染并行。
#
# ★ 注意：本片的内容文件就是 `script.json`（台词 + 逐句 rate，页面与配音链同读它）。
#   不要把它改名成 content.json —— DEMO.md / src/main.js / tts_local.py 都以 script.json 为准。
set -e
D=styles/paper-lantern/demo
PY=.venv/bin/python
FPS=24

# 1. 配音（Index-TTS 本地，零样本克隆）→ $D/vo/*.wav + $D/vo/dur.json
#    走 demo/tts/gen.py（编排器的「demo 自带 TTS」入口）；它会带上 --target 对齐已有时间轴。
$PY $D/tts/gen.py

# 2. 时间线（Windows node；页面读 vo/dur.json 排镜头与字幕窗）→ $D/out/timeline.json
node $D/render/cues.mjs

# 3. 混音（旁白 + 配乐 + 音效）→ $D/out/mix.wav
$PY $D/mix.py

# 4. 渲染（Windows GPU；--q content=script.json 见文件头说明）
node core/render/video.mjs $D --workers 6 --q "content=script.json"

# 5. 混流
V=$D/out/video_gpu.mp4
A=$D/out/mix.wav
O=styles/paper-lantern/paper-lantern.mp4
sh core/render/mux.sh "$V" "$A" "$O" "$FPS"
