#!/bin/sh
# hd-2d · HD-2D —— 本 demo 完整链（cwd = 仓库根；步骤与 DEMO.md「Build notes」一致）。
#
# ★ 本文件对编排器（lemo-tools/lemo-make.mjs）有一处**声明**作用，务必保留：
#   渲染行 `node core/render/video.mjs $D … --q tilt=1 …`。
#   编排器只从 build.sh 里读这一行的 --q（qIntent，lemo-make.mjs:1137-1155），**取不到就一个页面参数都不传**。
#   ⇒ 对本片 `--q tilt=1` **不是可选参数，是形态开关**：随库成片 hd-2d.mp4 是**移轴剪**（the tilt-shift cut），
#     而 `?tilt=1` 正是打开移轴的那一个页面开关（demo/main.js:33 `const TILT = Q.has('tilt')`）。
#     DEMO.md:133 明写：「`?tilt=1` is what makes the tilt-shift cut … Without it you get the plain DOF version」。
#     少了它，编排器渲出的是 **plain DOF 版**（非移轴），与 shipped 不是同一部片子。
#
# ★ --out 用 out/video_tilt.mp4（本 demo 自己的中间片名），理由：
#   ① DEMO.md:127/130 与 tools/render_range.mjs:3 都按这个名写 —— Partial re-render 要接在
#      `out/video_tilt.mp4` 上（`_distill.json` 的 sources 也引它），改名会断掉那条已记录的流程；
#   ② 编排器渲染时**固定**落 <demo>/out/video_gpu.mp4（lemo-make.mjs:1483/1489），与 build.sh 的 --out 无关
#      ⇒ 两条路各写各的中间片，互不覆盖，也不影响编排器成片；
#   ③ 显式 --out 且与第 6 步 mux 的输入 $V 指向**同一文件**：不写 --out 时 video.mjs 默认写 out/video.mp4
#      （core/render/video.mjs:13），会与 mux 读的文件不一致，静默混入上一次遗留的旧片。
set -e
D=styles/hd-2d/demo
PY=.venv/bin/python
FPS=60

# 0. 配乐源（git-ignored；仅全新 clone 需要联网取回，本机已有则跳过）（DEMO.md:106-107）
[ -f $D/music/src/sb_precipice.mp3 ] || curl -L -o $D/music/src/sb_precipice.mp3 https://www.scottbuckley.com.au/library/wp-content/uploads/2021/01/sb_precipice.mp3

# 1. 配音（Kokoro）+ whisper 逐句校对 → $D/voices/*.wav + dur.json（DEMO.md:109-111）
$PY core/tts/tts.py $D/lines.json $D/voices
$PY core/tts/asr_check.py $D/lines.json $D/voices      # demo: 1 expected DIFF（n1 "Graywater" → "gray water"）

# 2. 配乐：Scott Buckley《Precipice》按画面剪成五段 → $D/music/score.wav（+ CUES.md / measure.json）（DEMO.md:113-114）
(cd $D/music && ../../../../.venv/bin/python edit.py)

# 3. 混音（旁白 + 对白 + 配乐 + 环境床 + 拟音 + 逐句自动避让）→ $D/mix.wav（DEMO.md:116-117）
$PY $D/mix.py

# 4. 字幕 → styles/hd-2d/hd-2d.srt（DEMO.md:119-120）
$PY $D/tools/srt.py

# 5. 渲染 TILT-SHIFT CUT（随库成片的那一版）：4590 帧 @ 60 fps（DEMO.md:125-127）
#    ★ --q tilt=1 是形态开关，不是可选参数（见文件头）。
node core/render/video.mjs $D --fps $FPS --workers 6 --q tilt=1 --out $D/out/video_tilt.mp4

# 6. 混流：第 4 参 = fps 60，第 5 参 = grain 0（像素画不加胶片颗粒）（DEMO.md:129-130）
#    ★ 60 与 0 写**字面量**：编排器 muxIntent() 只认 mux.sh 行尾的纯数字（lemo-make.mjs:1088-1098），
#      写成 "$FPS" 会让它取不到颗粒 ⇒ 退回 mux 脚本默认 2，与 shipped 的 grain 0 不符。
V=$D/out/video_tilt.mp4
A=$D/mix.wav
O=styles/hd-2d/hd-2d.mp4
sh core/render/mux.sh "$V" "$A" "$O" 60 0
