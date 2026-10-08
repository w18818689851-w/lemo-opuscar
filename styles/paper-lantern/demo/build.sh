#!/bin/sh
# paper-lantern · 纸雕灯影 —— 本 demo 完整链（cwd = 仓库根；与 DEMO.md「Build notes」一致）。
#   ★ 2026-10-08 澄清（保留原句）：与 DEMO.md「Build notes」一致的是**参数**（30 fps / grain 0）；
#     **渲染产物文件名不同**——本文件与编排器都落 `out/video_gpu.mp4`，而 `DEMO.md:150` 写的是 `out/video.mp4`，
#     文件名以编排器命名为准（第 4 步已显式 `--out $D/out/video_gpu.mp4`，与第 5 步 mux 的输入同路径）。
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
FPS=30

# 1. 配音（Index-TTS 本地，零样本克隆）→ $D/vo/*.wav + $D/vo/dur.json
#    走 demo/tts/gen.py（编排器的「demo 自带 TTS」入口）；它会带上 --target 对齐已有时间轴。
$PY $D/tts/gen.py

# 2. 时间线（Windows node；页面读 vo/dur.json 排镜头与字幕窗）→ $D/out/timeline.json
node $D/render/cues.mjs

# 3. 混音（旁白 + 配乐 + 音效）→ $D/out/mix.wav
$PY $D/mix.py

# 4. 渲染（Windows GPU；--q content=script.json 见文件头说明）
#    ★ 必须显式 --out，且**与第 5 步 mux 的输入 $V 指向同一个文件**：不写 --out 时 video.mjs 默认写
#    out/video.mp4（core/render/video.mjs:13），而第 5 步读的是 out/video_gpu.mp4 —— 那样单独跑本脚本
#    会静默混入上一次遗留的 out/video_gpu.mp4。显式 --out 后二者同一路径，杜绝该隐患。
node core/render/video.mjs $D --fps $FPS --workers 6 --q "content=script.json" --out $D/out/video_gpu.mp4

# 5. 混流（第 4 参 = fps，第 5 参 = grain；本风格声明「no grain」⇒ 传 0，见 DEMO.md:150 的 `30 0`）
V=$D/out/video_gpu.mp4
A=$D/out/mix.wav
O=styles/paper-lantern/paper-lantern.mp4
sh core/render/mux.sh "$V" "$A" "$O" "$FPS" 0
