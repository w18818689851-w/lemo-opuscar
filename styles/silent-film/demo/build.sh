#!/bin/sh
# 从零重现《The Runaway Loaf》：sh styles/silent-film/demo/build.sh（任意目录运行）
set -e
cd "$(dirname "$0")/../../.."
PY=.venv/bin/python; D=styles/silent-film/demo; O=styles/silent-film
# 视频编码器：**未设 LEMO_VENC ⇒ 走 GPU 的 h264_nvenc**（用户硬规则：渲染一律 GPU 优先）；
# 显式 libx264 才走 CPU；其它值报错退出，绝不静默回落 CPU。
case "${LEMO_VENC:-}" in
  ''|h264_nvenc) VARG="-c:v h264_nvenc -preset p5 -profile high -rc vbr -cq 30 -b:v 0";;
  libx264) VARG="-c:v libx264 -preset slow -crf 25 -tune grain";;
  # ★ 本行报错标签**不能**出现字面量 "mux.sh"：编排器 muxIntent() 取的是**第一条**非注释、含 'mux.sh' 的行
  #   （lemo-make.mjs:1088-1098），若此处出现会被误当成 mux 调用行 ⇒ 读不到下面第 7 步声明的 grain 1。
  *) echo "mux step: LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '$LEMO_VENC'. Not falling back to the CPU encoder silently: a typo would look like GPU encoding while libx264 does the work." >&2; exit 1;;
esac
node $D/tools/dump_timeline.mjs                                   # 1. 速度网格（cue sheet 分段）→ timeline.json
$PY $D/music/score.py                                             # 2. 原创默片钢琴伴奏（立式钢琴 + 簧风琴）→ music/score.wav + score.json
$PY $D/tools/cuecheck.py                                          # 3. 画面卡点 ↔ 配乐卡点
$PY $D/mix.py                                                     # 4. 配乐 + 放映机（开机、底噪、静音段、片尾甩片）→ mix.wav
$PY $D/tools/subs.py && $PY core/render/srt.py $D/out/srt.json $O/silent-film.srt      # 5. 字幕卡文字 → .srt
node core/render/video.mjs $D --fps 24 --workers 2 --out $D/out/video24.mp4           # 6. 逐帧渲染（4 workers 约 45 s）
sh core/render/mux.sh $D/out/video24.mp4 $D/mix.wav $D/out/master.mp4 24 1            # 7. 合成：−14 LUFS（颗粒已在画面里，mux 只加 1）
ffmpeg -loglevel error -i $D/out/master.mp4 $VARG -c:a copy -movflags +faststart -y $O/silent-film.mp4   # 8. 胶片颗粒压缩（~80 MB）
# 9. 静帧：海报 / 风格帧 / 关卡帧 / 重画样张
node core/render/still.mjs $D 7.4 23.2 44.9 --out $D/out/still --prefix p_
cp $D/out/still/p_7.4.jpg $O/poster.jpg; cp $D/out/still/p_23.2.jpg $D/stills/styleframe.jpg; cp $D/out/still/p_44.9.jpg $D/stills/frame_v2_tender.jpg
node core/render/still.mjs $D 0 --q scene=frames.modelSheet --out $D/out/still --prefix ms_ && cp $D/out/still/ms_0.jpg $D/stills/modelsheet_v2.jpg
node core/render/still.mjs $D 0 --q scene=frames.cardSheet --out $D/out/still --prefix cs_ && cp $D/out/still/cs_0.jpg $D/stills/frame_v1_cards.jpg
node core/render/still.mjs $D 0 --q scene=frames.redrawSample --out $D/out/still --prefix rd_ && cp $D/out/still/rd_0.jpg $D/stills/redraw_v1.jpg
