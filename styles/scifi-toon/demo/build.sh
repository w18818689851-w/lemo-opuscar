#!/bin/sh
# 从零重现成片：sh styles/scifi-toon/demo/build.sh   （在仓库根目录或任意位置运行均可）
set -e
cd "$(dirname "$0")/../../.."
PY=.venv/bin/python; D=styles/scifi-toon/demo
$PY core/tts/tts.py $D/lines.json $D/out/raw          # 1. Kokoro 配音（原始 24k）
$PY $D/voice.py                                       # 2. 角色处理 + 截断 + 口型包络 → voices/
$PY $D/asr.py $D/lines.json $D/voices                 # 3. whisper 逐句校对
node core/render/events.mjs $D                        # 4. 时间线 → events.json（对白/拟音/配乐 cue）
$PY $D/music/score.py                                 # 5. 原创配乐合成 → music/score.wav
$PY $D/mix.py                                         # 6. 拟音 + 对白 + 配乐闪避 + 环境 → mix.wav
node $D/srt.mjs                                       # 7. 字幕 → scifi-toon.srt
node core/render/video.mjs $D --fps 24 --workers 4 --out $D/out/video24.mp4   # 8. 逐帧渲染（~15s）
# 9. 合成 + −14 LUFS
#    ★ 第 4/5 参（fps / grain）写**字面量**：编排器 `muxIntent()` 只认 `mux.sh` 之后行尾的**纯数字**
#      （`lemo-make.mjs:1088-1098`；变量如 `$FPS` 会被判 `null`）。★ 2026-10-08 补上显式 `2`：
#      此前只传 4 参 ⇒ `muxIntent` 读到 `null` ⇒ 编排器落 `core/render/mux.sh:36` 的默认 `GR="${5:-2}"`。
#      值**不变**（仍是 2，与本片已发布影片一致），但把「意图」写死、消除对默认值的静默依赖。
sh core/render/mux.sh $D/out/video24.mp4 $D/mix.wav styles/scifi-toon/scifi-toon.mp4 24 2   # 9. 合成 + −14 LUFS
