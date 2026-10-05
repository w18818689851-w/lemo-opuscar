#!/bin/zsh
# 拼接分段 → 轻颗粒 → 混入配乐 → 成片
# 用法：./mux.sh [输出路径]
#   OUTDIR=out_ej（默认，英日版）→ 默认输出 ../pictogram-motion.mp4（= styles/pictogram-motion/pictogram-motion.mp4）
#   OUTDIR=out   （中文版）      → 默认输出 out/pictogram-motion_zh.mp4
set -e
cd "${0:A:h}"
SEG="${OUTDIR:-out_ej}"
if [[ "$SEG" == "out_ej" ]]; then DEF="../pictogram-motion.mp4"; else DEF="$SEG/pictogram-motion_zh.mp4"; fi
OUT="${1:-$DEF}"
# 视频编码器：**未设 LEMO_VENC ⇒ 走 GPU 的 h264_nvenc**（用户硬规则：渲染一律 GPU 优先）；
# 显式 libx264 才走 CPU；其它值报错退出，绝不静默回落 CPU。
case "${LEMO_VENC:-}" in
  ''|h264_nvenc) VARG="-c:v h264_nvenc -preset p5 -profile high -rc vbr -cq 19 -b:v 0";;
  libx264) VARG="-c:v libx264 -preset slow -crf 14 -profile:v high";;
  *) echo "mux.sh: LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '$LEMO_VENC'. Not falling back to the CPU encoder silently: a typo would look like GPU encoding while libx264 does the work." >&2; exit 1;;
esac
ffmpeg -y -loglevel error -f concat -safe 0 -i $SEG/list.txt -i music/music.wav \
  -vf "tpad=stop_duration=2:stop_mode=clone,noise=c0s=4:c0f=t+u,format=yuv420p" \
  $VARG -r 60 -g 120 \
  -c:a aac -b:a 320k -ar 48000 -map 0:v -map 1:a -shortest -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
