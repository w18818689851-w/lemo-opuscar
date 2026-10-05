#!/bin/sh
# 成片合成（本片版）：先走 core/render/mux.sh（两遍 loudnorm −14 LUFS + 颗粒），再按 CRF 28 + tune grain 重编码。
# 木刻的细排线 + 每帧墨色与颗粒让 CRF 19 的片子到 326 MB；CRF 28 在 1:1 裁切对比里看不出差别，93 MB。
# 用法：sh tools/mux.sh video.mp4 mix.wav out.mp4 [fps] [grain]
set -e
V="$1"; A="$2"; O="$3"; FPS="${4:-24}"; GR="${5:-6}"
R="$(cd "$(dirname "$0")/../../../.." && pwd)"; TMP="$(dirname "$V")/master_crf19.mp4"
sh "$R/core/render/mux.sh" "$V" "$A" "$TMP" "$FPS" "$GR"
# ── 本地补丁（2026-10-03 回灌 core/render/mux.sh）──
#   ① 音频比画面短 → 补静音到「画面长度 + 一帧」，否则 -shortest 切掉最后一帧（编排器判 MUX_FAIL 帧数不符）
#   ② 编码器 **GPU 优先**：未设 LEMO_VENC ⇒ h264_nvenc；显式 libx264 才走 CPU；其它值报错退出（硬规则：渲染/合成一律本地 GPU）
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | head -1; }
VD=$(dur "$V"); AD=$(dur "$A"); PAD=""
if awk -v a="$AD" -v v="$VD" 'BEGIN { exit !(a + 0 > 0 && v + 0 > 0 && a + 0 < v - 1e-6) }'; then
  PD=$(awk -v v="$VD" -v f="$FPS" 'BEGIN { printf "%.6f", v + 1 / f }')
  PAD=",apad=whole_dur=$PD"
  echo "mux.sh: note: audio ($AD s) shorter than video ($VD s); padding to $PD s (one frame past, so -shortest cannot clip)" >&2
fi
CRF="${CRF:-28}"; TUNE=" -tune grain"
case "${LEMO_VENC:-}" in
  ''|h264_nvenc) VARG="-c:v h264_nvenc -preset p5 -profile high -rc vbr -cq $(awk -v c="$CRF" 'BEGIN{printf "%d",(c+0)+4}') -b:v 0";;
  libx264) VARG="-c:v libx264 -preset slow -crf $CRF $TUNE";;
  *) echo "mux.sh: LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '$LEMO_VENC'. Not falling back to the CPU encoder silently: a typo would look like GPU encoding while libx264 does the work." >&2; exit 1;;
esac
ffmpeg -y -loglevel error -i "$TMP" $VARG -c:a copy -movflags +faststart "$O"
rm -f "$TMP"; ls -la "$O" | awk '{printf "%s  %.1f MB\n", $9, $5/1e6}'
