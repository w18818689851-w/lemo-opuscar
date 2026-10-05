#!/bin/sh
# 拼接 render.mjs video 产出的分段 + 混入 music.wav → 成片
# 用法：sh finish.sh [out.mp4]   默认输出 ../game-show.mp4（会覆盖库里的成片，试跑请传别的路径，如 out/test.mp4）
# 参数与 v3 成片一致：x264 slow crf16 / AAC 256k 48 kHz / 两遍 loudnorm → −14 LUFS
# AUDIO_FROM=旧成片.mp4 sh finish.sh …  → 不重混，直接拷贝旧成片的音轨（局部重渲画面、音频保持原样时用）
set -e
cd "$(dirname "$0")"
O="${1:-../game-show.mp4}"
# 视频编码器：**未设 LEMO_VENC ⇒ 走 GPU 的 h264_nvenc**（用户硬规则：渲染一律 GPU 优先）；
# 显式 libx264 才走 CPU；其它值报错退出，绝不静默回落 CPU。
case "${LEMO_VENC:-}" in
  ''|h264_nvenc) VARG="-c:v h264_nvenc -preset p5 -profile high -rc vbr -cq 21 -b:v 0";;
  libx264) VARG="-c:v libx264 -preset slow -crf 16";;
  *) echo "mux.sh: LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '$LEMO_VENC'. Not falling back to the CPU encoder silently: a typo would look like GPU encoding while libx264 does the work." >&2; exit 1;;
esac
ffmpeg -y -loglevel error -f concat -safe 0 -i out/list.txt -c copy out/video_noaudio.mp4
if [ -n "$AUDIO_FROM" ]; then
  ffmpeg -y -loglevel error -i out/video_noaudio.mp4 -i "$AUDIO_FROM" -map 0:v -map 1:a $VARG -pix_fmt yuv420p -c:a copy -movflags +faststart "$O"
  echo "$O (audio copied from $AUDIO_FROM)"; exit 0
fi
# ★ AAC 编码余量（2026-10-03 与 core/render/mux.sh 对齐：默认 TP 由 −1.7 改为 −3.5，可用 LEMO_LN_TP 覆盖）。
#   全量 43 部成片扫描显示 AAC 过冲最高 +1.66 dB（标定时以为 ≤0.22 dB），19/43 超 −1.2 dBTP、6 部真峰值为正。
#   降 TP 是严格改进：响度代价 ≤0.72 LU（仍在 −14±1 内），真峰值只降不升。
LN_TP="${LEMO_LN_TP:--3.5}"
J=$(ffmpeg -hide_banner -nostats -i music.wav -af loudnorm=I=-14:TP=$LN_TP:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
g() { echo "$J" | /usr/bin/grep "\"$1\"" | sed 's/.*: "\(.*\)".*/\1/'; }
LN="loudnorm=I=-14:TP=$LN_TP:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true"
ffmpeg -y -loglevel error -i out/video_noaudio.mp4 -i music.wav \
  -filter_complex "[1:a]$LN,aresample=48000[a]" -map 0:v -map "[a]" \
  $VARG -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart -shortest "$O"
echo "$O"
# ── 达标复核（2026-10-03 与 core/render/mux.sh 对齐）──
#   交付线 −1.2 dBTP 定义在**真峰值**上；判据同时看采样峰值(astats)与真峰值(loudnorm input_tp)，
#   因为实测全量 43 部里有 5 部「采样峰值达标而真峰值超标」会被漏报（最大差 1.62 dB）。
#   静音/极轻音频跳过（量出来是 -inf 就跳过，硬判会误报）。
R=$(ffmpeg -hide_banner -nostats -i "$O" -af ebur128=peak=true,astats=measure_perchannel=none -f null - 2>&1 | grep -E "^\s+(I|LRA|Peak):|Peak level dB" | head -6)
echo "$R"
OI=$(echo "$R" | awk '$1 == "I:" { print $2 }')
OP=$(echo "$R" | awk '$1 == "Peak:" { print $2 }')
OPX=$(echo "$R" | awk -F': ' '/Peak level dB/ { print $2; exit }')
[ -n "$OPX" ] || OPX="$OP"
if [ -n "$OI" ] && [ "$OI" != "-inf" ]; then
  OPT=$(ffmpeg -hide_banner -nostats -i "$O" -af loudnorm=I=-14:TP=-1.7:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p' | grep '"input_tp"' | sed 's/.*: "\(.*\)".*/\1/')
  [ -n "$OPT" ] || OPT="$OPX"
  awk -v i="$OI" -v p="$OPX" -v t="$OPT" 'BEGIN { exit !(i + 0 < -15 || i + 0 > -13 || p + 0 > -1.2 || t + 0 > -1.2) }' \
    && echo "mux.sh: warning: the film missed the target (-14 LUFS, true peak <= -1.2 dB): measured $OI LUFS, true peak $OPT dBTP (sample peak $OPX dB; ebur128 1-decimal readout $OP dB). The mix is probably clipping or has very hot peaks: lower it and tame the peaks, then mux again" >&2
fi
exit 0
