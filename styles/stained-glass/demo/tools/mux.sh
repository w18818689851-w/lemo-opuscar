#!/bin/sh
# 合成成片：mux.sh video.mp4 mix.wav out.mp4 [fps] [grain]
# 视频按目标帧率输出（定格片段自动复制帧）；grain = 颗粒强度（默认 2，0 = 不加；像素/矢量风格用 0）
# 音频 = 两遍 loudnorm → −14 LUFS + **编码后复核闭环**（2026-10-05 与 core/render/mux.sh 对齐，替换原来的静态 TP −3.5）。
# ★ 为什么不能再用固定余量：交付目标定义在**成片（AAC）**上（真峰值 ≤ −1.2 dBTP、响度 −14±1 LU），
#   而 AAC 会把源 PCM 的码间真峰值抬高（实测过冲 0.08–1.66 dB，且对 TP 目标**非单调**）⇒ 固定值顾此失彼：
#   留少了峰值越线（全量 43 部实测 19 部超 −1.2、6 部真峰值为正），留多了高 LRA 的片子响度被 loudnorm 的动态模式钳出窗
#   （实测 silkscreen-poster：TP −3.5 → 成片 −16.05 LUFS，已出 −14±1）。
# ⇒ 正解：**从最保响度的 −1.7 起步**编一次，量成片真峰值（loudnorm 的 input_tp，4× 过采样）与响度（input_i）；
#   不达标就把 TP 目标按 LEMO_LN_TP_STEP 下调重编，**只重做音频**（视频流 -c:v copy 复用，不额外编视频），最多 LEMO_LN_TP_TRIES 档；
#   真峰值一旦达标就收手（响度只会随 TP 下行更差）；达标的片子只编码一次；两条口径无法兼顾时打印每一档 (I, TP) 并取较优档。
# 环境变量：LEMO_LN_TP（起点，默认 −1.7）、LEMO_LN_TP_STEP（步长，默认 0.25）、LEMO_LN_TP_TRIES（最多几档，默认 8）、
#           LEMO_VCOPY=1（视频流不重编、直接 -c:v copy，只重做音频）。
V="$1"; A="$2"; O="$3"; FPS="${4:-24}"; GR="${5:-2}"
LN_TP="${LEMO_LN_TP:--1.7}"
LN_TP_STEP="${LEMO_LN_TP_STEP:-0.25}"
LN_TP_TRIES="${LEMO_LN_TP_TRIES:-8}"
case "$LN_TP_TRIES" in ''|*[!0-9]*) echo "mux.sh: LEMO_LN_TP_TRIES must be a positive integer, got '$LN_TP_TRIES'" >&2; exit 1;; esac
[ "$LN_TP_TRIES" -ge 1 ] || { echo "mux.sh: LEMO_LN_TP_TRIES must be >= 1, got '$LN_TP_TRIES'" >&2; exit 1; }
case "$LN_TP_STEP" in ''|*[!0-9.]*) echo "mux.sh: LEMO_LN_TP_STEP must be a number, got '$LN_TP_STEP'" >&2; exit 1;; esac
# 第一遍：量响度。★ 换 TP 目标必须重跑这一遍 —— 测量值（I/TP/LRA/thresh）与 TP 目标无关，但 target_offset **依赖** TP。
J=$(ffmpeg -hide_banner -nostats -i "$A" -af loudnorm=I=-14:TP=$LN_TP:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
g() { echo "$J" | grep "\"$1\"" | sed 's/.*: "\(.*\)".*/\1/'; }
jget() { echo "$1" | grep "\"$2\"" | sed 's/.*: "\(.*\)".*/\1/'; }
ln_for_tp() {
  if [ "$1" = "$LN_TP" ]; then
    _i=$(g input_i); _t=$(g input_tp); _l=$(g input_lra); _th=$(g input_thresh); _o=$(g target_offset)
  else
    _j=$(ffmpeg -hide_banner -nostats -i "$A" -af loudnorm=I=-14:TP=$1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
    _i=$(jget "$_j" input_i); _t=$(jget "$_j" input_tp); _l=$(jget "$_j" input_lra); _th=$(jget "$_j" input_thresh); _o=$(jget "$_j" target_offset)
  fi
  # ★ 变量一律加 ${} 花括号：zsh 会把 `$var:l` 里的 `:l` 当成「转小写」修饰符吃掉（实测 `offset=$_o:linear=true` 变成 `offset=0.42inear=true`，loudnorm 直接报错）。
  echo "loudnorm=I=-14:TP=${1}:LRA=11:measured_I=${_i}:measured_TP=${_t}:measured_LRA=${_l}:measured_thresh=${_th}:offset=${_o}:linear=true"
}
# 静音 / 极轻（低于 −70 LUFS，loudnorm 量不出来）：跳过响度归一并警告，仍然出片（没有可复核的响度 ⇒ 不重试）。
NORM=1
for k in input_i input_tp input_lra input_thresh target_offset; do case "$(g $k)" in ''|*inf*|*nan*) NORM=0;; esac; done
[ "$NORM" = 1 ] || echo "mux.sh: warning: the audio is silent or quieter than -70 LUFS, so loudness normalisation was skipped" >&2
if [ "$GR" = "0" ]; then VF="fps=$FPS,format=yuv420p"; else VF="fps=$FPS,noise=c0s=$GR:allf=t,format=yuv420p"; fi
# ── 本地补丁（保留，2026-10-03 回灌 core/render/mux.sh）──
#   ① 音频比画面短 → 补静音到「画面长度 + 一帧」，否则 -shortest 切掉最后一帧（编排器判 MUX_FAIL 帧数不符）
#   ② 编码器 **GPU 优先**：未设 LEMO_VENC ⇒ h264_nvenc；显式 libx264 才走 CPU；其它值报错退出（硬规则：渲染/合成一律本地 GPU）
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | head -1; }
VD=$(dur "$V"); AD=$(dur "$A"); PAD=""
if awk -v a="$AD" -v v="$VD" 'BEGIN { exit !(a + 0 > 0 && v + 0 > 0 && a + 0 < v - 1e-6) }'; then
  PD=$(awk -v v="$VD" -v f="$FPS" 'BEGIN { printf "%.6f", v + 1 / f }')
  PAD=",apad=whole_dur=$PD"
  echo "mux.sh: note: audio ($AD s) shorter than video ($VD s); padding to $PD s (one frame past, so -shortest cannot clip)" >&2
fi
CRF="${CRF:-22}"; TUNE=""
case "${LEMO_VENC:-}" in
  ''|h264_nvenc) VARG="-c:v h264_nvenc -preset p5 -profile high -rc vbr -cq $(awk -v c="$CRF" 'BEGIN{printf "%d",(c+0)+4}') -b:v 0";;
  libx264) VARG="-c:v libx264 -preset slow -crf $CRF $TUNE";;
  *) echo "mux.sh: LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '$LEMO_VENC'. Not falling back to the CPU encoder silently: a typo would look like GPU encoding while libx264 does the work." >&2; exit 1;;
esac
# ── 编码 + 复核闭环 ──────────────────────────────────────────────────────────
# 编码一次：$1 = TP 目标，$2 = 输出路径，$3 = 1 表示视频流直接 -c:v copy 复用 $VREF（0 = 按 $VF 重编）。
[ "$NORM" = 1 ] || LN_TP_TRIES=1
VREF="$V"; FIRST_COPY=0
[ "${LEMO_VCOPY:-}" = "1" ] && FIRST_COPY=1
mux_once() {
  if [ "$NORM" = 1 ]; then _ln=$(ln_for_tp "$1"); else _ln="anull"; fi
  if [ "$3" = "1" ]; then
    ffmpeg -y -loglevel error -i "$VREF" -i "$A" \
      -filter_complex "[1:a]$_ln,aresample=48000$PAD[a]" \
      -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest "$2"
  else
    # shellcheck disable=SC2086  (VARG 要按空格拆成多个参数)
    ffmpeg -y -loglevel error -i "$V" -i "$A" \
      -filter_complex "[0:v]$VF[v];[1:a]$_ln,aresample=48000$PAD[a]" \
      -map "[v]" -map "[a]" $VARG -r "$FPS" -c:a aac -b:a 256k -movflags +faststart -shortest "$2"
  fi
}
# 量成片：真峰值取 loudnorm 的 4× 过采样 input_tp（交付口径），响度取同一次解码的 input_i。回显 "I TP"。
measure_film() {
  _j=$(ffmpeg -hide_banner -nostats -i "$1" -af loudnorm=I=-14:TP=-1.7:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
  echo "$(jget "$_j" input_i) $(jget "$_j" input_tp)"
}
# 临时文件名：后缀插在扩展名之前（**必须保留扩展名**，否则 ffmpeg 认不出封装器）。
tmp_out() {
  case "$1" in
    */*) _d="${1%/*}"; _b="${1##*/}";;
    *)   _d="."; _b="$1";;
  esac
  case "$_b" in
    *.*) echo "$_d/${_b%.*}.$2.${_b##*.}";;
    *)   echo "$_d/$_b.$2";;
  esac
}
VIDOUT=$(tmp_out "$O" tryvid)
TP_TRY="$LN_TP"; ATTEMPT=0; BEST_R=""; BEST_S=""; BEST_TP=""; BEST_I=""; BEST_P=""; BEST_OUT=""; TRIES=""; TEMPS=""
while [ "$ATTEMPT" -lt "$LN_TP_TRIES" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" = 1 ]; then OUT="$O"; else OUT=$(tmp_out "$O" "try$ATTEMPT"); TEMPS="$TEMPS $OUT"; fi
  if [ "$ATTEMPT" = 1 ]; then
    mux_once "$TP_TRY" "$OUT" "$FIRST_COPY" || { rm -f "$OUT" $TEMPS "$VIDOUT"; echo "mux.sh: ffmpeg failed while writing '$OUT' (its message is above)" >&2; exit 1; }
  else
    # 重编只重做音频：先把首档成片的**已滤镜视频流**抽成临时文件（-c:v copy），再拿它当输入 —— 这样各档视频逐字节相同。
    [ -f "$VIDOUT" ] || ffmpeg -y -loglevel error -i "$O" -map 0:v -c:v copy -an "$VIDOUT" \
      || { rm -f $TEMPS "$VIDOUT"; echo "mux.sh: could not extract the video stream of '$O' for a cheaper audio-only retry" >&2; exit 1; }
    # ★ 只在真抽出了 $VIDOUT 时才指（LEMO_VCOPY=1 时上面那行不抽，VREF 保持 $V —— 首档用的源，语义一致）。
    #   修过的真 bug：无条件赋值会让 LEMO_VCOPY=1 的重试指向不存在的文件而 die。
    if [ -f "$VIDOUT" ]; then VREF="$VIDOUT"; fi
    mux_once "$TP_TRY" "$OUT" 1 || { rm -f $TEMPS "$VIDOUT"; echo "mux.sh: ffmpeg failed while re-muxing '$OUT' (its message is above)" >&2; exit 1; }
  fi
  [ -s "$OUT" ] || { rm -f $TEMPS "$VIDOUT"; echo "mux.sh: no output was written to '$OUT'" >&2; exit 1; }
  _M=$(measure_film "$OUT"); OI="${_M%% *}"; OP="${_M##* }"
  TP_OK=0; I_OK=0
  awk -v p="$OP" 'BEGIN { exit !(p + 0 <= -1.2) }' && TP_OK=1
  awk -v i="$OI" 'BEGIN { d = i + 0 + 14; if (d < 0) d = -d; exit !(d <= 1.0) }' && I_OK=1
  TRIES="$TRIES$TP_TRY:($OI,$OP) "
  echo "mux.sh: attempt $ATTEMPT: TP target $TP_TRY -> film true peak $OP dBTP, loudness $OI LUFS" >&2
  # 记下目前最好的一档：r 越小越好（0 = 两条都达标），同 r 内 s（响度偏离 / 峰值超出）越小越好。
  _R=0; [ "$TP_OK" = 1 ] || _R=2; [ "$I_OK" = 1 ] || _R=$((_R + 1))
  if [ "$_R" -le 1 ]; then _S=$(awk -v i="$OI" 'BEGIN { d = i + 14; if (d < 0) d = -d; print d }')
  else _S=$(awk -v p="$OP" 'BEGIN { d = p + 1.2; if (d < 0) d = 0; print d }'); fi
  if [ -z "$BEST_R" ] || awk -v r1="$_R" -v s1="$_S" -v r0="$BEST_R" -v s0="$BEST_S" 'BEGIN { exit !(r1 < r0 || (r1 == r0 && s1 < s0)) }'; then
    BEST_R="$_R"; BEST_S="$_S"; BEST_TP="$TP_TRY"; BEST_I="$OI"; BEST_P="$OP"; BEST_OUT="$OUT"
  fi
  # 真峰值一旦达标就收手：响度只会随 TP 下行更差（实测单调），再降没有意义。
  [ "$TP_OK" = 1 ] && break
  TP_TRY=$(awk -v t="$TP_TRY" -v s="$LN_TP_STEP" 'BEGIN { printf "%.3f", t - s }')
done
[ "$BEST_OUT" = "$O" ] || mv -f "$BEST_OUT" "$O"
rm -f $TEMPS "$VIDOUT"
echo "$O"
# ebur128 出人看的 I / LRA / Peak；astats 串在同一条 -af 链里提供 6 位小数的采样峰值（同一次解码，不额外花钱）。
R=$(ffmpeg -hide_banner -nostats -i "$O" -af ebur128=peak=true,astats=measure_perchannel=none -f null - 2>&1 | grep -E "^\s+(I|LRA|Peak):|Peak level dB" | head -6)
echo "$R"
if [ "$NORM" = 1 ]; then
  OI=$(echo "$R" | awk '$1 == "I:" { print $2 }')
  OP=$(echo "$R" | awk '$1 == "Peak:" { print $2 }')
  OPX=$(echo "$R" | awk -F': ' '/Peak level dB/ { print $2; exit }')
  [ -n "$OPX" ] || OPX="$OP"
  # ★ 真峰值取闭环里同一条 loudnorm（4× 过采样）的读数（量的是最终产出，胜出那一档已 mv 成 $O），
  #   口径与 measure_film 完全一致，且**不额外再解一遍**。
  OPT="$BEST_P"; [ -n "$OPT" ] || OPT="$OPX"
  # 这里的 −1.2 是**成片交付目标**（量的是编码后的文件），不是 loudnorm 的 TP 目标（LN_TP）；
  # 两者刻意留差 —— 那正是留给 AAC 过冲的余量，别把这里也改成 LN_TP（那等于把交付标准偷偷放宽）。
  if awk -v i="$OI" -v p="$OPX" -v t="$OPT" 'BEGIN { exit !(i + 0 < -15 || i + 0 > -13 || p + 0 > -1.2 || t + 0 > -1.2) }'; then
    echo "mux.sh: warning: the film missed the target (-14 LUFS, true peak <= -1.2 dB): measured $OI LUFS, true peak $OPT dBTP (sample peak $OPX dB; ebur128 1-decimal readout $OP dB). The mix is probably clipping or has very hot peaks: lower it and tame the peaks, then mux again" >&2
    [ "$BEST_R" = 0 ] || echo "mux.sh: warning: the two delivery lines cannot BOTH be met for this film: the true peak only comes under -1.2 dBTP at TP target $BEST_TP, but there the loudness is $BEST_I LUFS (outside -14 +/- 1 LU). Kept the best of $ATTEMPT tries; tried (loudness,true peak) per TP target: $TRIES" >&2
  fi
else
  ffmpeg -hide_banner -nostats -i "$O" -af ebur128 -f null - 2>&1 | grep -E "^\s+(I|LRA|Peak):" | head -3
fi
exit 0
