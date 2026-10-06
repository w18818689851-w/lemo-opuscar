#!/bin/sh
# 合成成片：mux.sh video.mp4 mix.wav out.mp4 [fps] [grain]
# 视频按目标帧率输出（定格片段自动复制帧）；grain = 颗粒强度（默认 2，0 = 不加；像素/矢量风格用 0）
# 音频两遍 loudnorm → −14 LUFS / TP 起点 −1.7（单遍会偏 0.5 LU 左右）；★ 编码后**复核成片**：真峰值 ≤ −1.2 dBTP 且响度 −14±1 LU 才算达标，
#   不达标就把 TP 目标按 LEMO_LN_TP_STEP 逐档下调重编（最多 LEMO_LN_TP_TRIES 档，重编只重做音频、视频流 -c:v copy 复用），最后打印实测的 I / LRA / 真峰值。
#   ★ 复核**量不出来**（measure_film 的 ffmpeg 失败 / 读数没解析出来）**不是「不达标」**：不降档重编（没有读数可依），
#     只打一次明确警告、照旧交付第 1 档成片 —— 交付的文件 / stdout / 退出码与「原来白跑满 8 档」时**完全相同**，只是不再白编 7 次。
# ⚠️ loudnorm 的 TP 目标（起点 −1.7）比交付目标（−1.2）低 0.5 dB —— 那是留给 AAC 编码的余量，见下面 LN_TP 的说明。别把两者当成不一致。
# ⚠️ 告警阈值必须与目标一致，而且**必须用够精度的读数**：目标是 TP ≤ −1.2，原来告警却用 p > −1（差 0.2 dB）。
#    但只把 −1 改成 −1.2 也没用 —— ebur128 的 Peak 只印 1 位小数，真峰值 −1.17 dBTP 会印成 "-1.2"，
#    而 "-1.2 > -1.2" 为假，照样静默放行（实测 lowpoly-island：ebur128 印 −1.2，astats −1.170596，
#    loudnorm input_tp −1.16，修前修后都不告警）。所以判据改用同一条 -af 链里 astats 的 6 位小数读数。
# （混音本身削波或峰值极高时，loudnorm 的动态模式两个目标都会错过，实测 −20 LUFS / +5 dBTP）
# 任何一步 ffmpeg 失败都以非 0 退出，并且不留半个文件；只有成品存在且非空才打印它的路径。
# 静音 / 极轻（低于 −70 LUFS，loudnorm 量不出来）的音频：只有"成功解码、量出来确实静音"才跳过响度归一并警告，仍然出片。
# 不是音频、没有音频流、或者文件坏了：以 1 退出，不出片。"坏"按实际解码出来的东西来判断，不是看到报错字样就算：
#   · 解码器报了错（损坏的 FLAC/MP3/M4A 常常 ffmpeg 报了错还返回 0）；
#   · 解出来的时长明显少于容器声称的（截断的 FLAC/MP3）；
#   · WAV 头里声明的音频比文件里实际有的多（写到一半被打断）。
#   `ffmpeg … -f wav -` 流式写出的 WAV 头里长度是占位值，解码完整，只是结尾会有三句解封装提示：那是好文件，照常出片（带一句说明）。
#   看不出来的一种：流式 WAV 恰好截断在采样边界上（头里没有长度可比，解码也没有错）。
# 音频比画面短：用静音补到【画面长度 + 一帧】（不会把视频截短）；音频更长：照旧截到画面长度（-shortest）。
#   ⚠️ 补的目标必须比画面长一帧，不能只补到画面长度 —— 见下面「音频比画面短就补静音」处的实测说明。
# 色彩：默认与以往完全一致（保持 video.mjs 出的 yuvj420p 全范围 / bt470bg 标签）；LEMO_COLOR=bt709 改成标准 yuv420p 限幅 / bt709（画面色值差 ±3 以内，但会与旧片有细微色差）。
# ★★ 帧数校验**不在本文件**（2026-10-06 性能审计实测，勿再误记）：
#   本脚本**不做任何全片扫帧** —— 全文没有 `ffprobe -count_frames`，也没有任何对视频流的解码
#   （唯一的视频解码就是下面 mux_once 里那一次编码本身；其余 ffmpeg/ffprobe 全部只碰音频 $A / $O 的音频）。
#   它只保证两件事：① 音频不比画面短（下面补静音，防 -shortest 切末帧）；② 输出存在且非空。
#   「渲染帧数 == 成片帧数」那道守卫在**编排器** D:/lemo-tools/lemo-make.mjs 的混流阶段：
#     `SRC_FRAMES=$(ffprobe -count_frames … "$VID")` / `OUT_FRAMES=$(ffprobe -count_frames … 成片)`
#     两处各一次全片扫帧，不一致就 `MUX_FAIL 帧数不符`。它拦的正是上面 ① 描述的同一类事故
#     （实测 backrooms 渲染 1433 帧 / 成片 1432 帧）。
#   ⇒ **别把「混流阶段」和「mux.sh」混为一谈**：那两次全片扫帧（各数秒）不在本文件里，
#     只改本文件**省不掉它们**；要提速得去编排器那一侧（动它属红线，需另行授权）。
die() { echo "mux.sh: $*" >&2; exit 1; }
V="$1"; A="$2"; O="$3"; FPS="${4:-24}"; GR="${5:-2}"
[ -n "$V" ] && [ -n "$A" ] && [ -n "$O" ] || die "usage: sh core/render/mux.sh video.mp4 mix.wav out.mp4 [fps=24] [grain=2]"
[ -f "$V" ] || die "video not found: $V"
[ -f "$A" ] || die "audio not found: $A"
case "$FPS" in ''|*[!0-9.]*) die "fps must be a number, got '$FPS'";; esac
case "$GR" in ''|*[!0-9.]*) die "grain must be a number (0 = none), got '$GR'";; esac
case "${LEMO_COLOR:-}" in ''|bt709) ;; *) die "LEMO_COLOR must be bt709 or unset, got '$LEMO_COLOR'";; esac

# 检查 WAV 头声明的音频长度有没有超出文件（截断在采样边界上的 WAV，ffmpeg 自己不会报任何错）。按字节逐个读长度，不依赖机器的字节序
wav_truncated() {   # 返回 0 = 头里声明的比文件里有的多；占位长度（0 或 0xFFFFFFFF）视为"长度未知"，不算截断
  [ "$(dd if="$1" bs=1 count=4 2>/dev/null)" = RIFF ] && [ "$(dd if="$1" bs=1 skip=8 count=4 2>/dev/null)" = WAVE ] || return 1
  _size=$(wc -c < "$1" | tr -d ' '); _off=12
  while [ $((_off + 8)) -le "$_size" ]; do
    _id=$(dd if="$1" bs=1 skip=$_off count=4 2>/dev/null)
    set -- "$1" $(od -An -tu1 -j $((_off + 4)) -N4 "$1"); _len=$(($2 + $3 * 256 + $4 * 65536 + $5 * 16777216))
    if [ "$_id" = data ]; then
      [ "$_len" -eq 0 ] || [ "$_len" -eq 4294967295 ] && return 1
      [ $((_off + 8 + _len)) -gt "$_size" ] && return 0 || return 1
    fi
    _off=$((_off + 8 + _len + (_len & 1)))
  done
  return 1
}

# ★ 编码余量（2026-10-02 实测，勿随手改回 −1.2）：
#   交付目标是**成片**（AAC）的真峰值 ≤ −1.2 dBTP，但 AAC 是有损编码，会把源 PCM 的码间真峰值抬高。
#   ffmpeg 的 AAC 256k 在本片素材上的实测过冲（loudnorm 的 input_tp 读数，2 位小数）：
#     PCM 目标 −1.20 → 成片 −1.12（+0.08）   ← 原来的值，成片超标，每次都打 missed the target 警告
#     PCM 目标 −1.35 → 成片 −1.16（+0.19）
#     PCM 目标 −1.50 → 成片 −1.28（+0.22）   ← 最坏
#     PCM 目标 −1.70 → 成片 −1.54（+0.16）
#   过冲不是常数（0.08–0.22，随编码器的比特分配而变），所以按**最坏 0.22** 留余量，再给约一倍安全边际 ⇒ 0.5 dB。
#   于是 loudnorm 的 TP 目标 = −1.2 − 0.5 = **−1.7**，交给编码器的 PCM 落在 −1.7，成片实测 ≈ −1.54 dBTP，
#   比交付目标低 0.34 dB —— 稳过，且响度完全不受影响（仍钉在 −14.0 LUFS，实测 I=−14.09）。
#   ⚠️ 别想用「改 mix.py 的最终限幅」来腾这个余量：loudnorm 动态模式会把输出真峰值重新钉死在 TP 目标上
#      （实测把 mix.wav 整体 −3/0/+3 dB 后重跑，output_TP 恒为 −1.20、output_I 恒为 −14.0）——
#      上游电平怎么改都改变不了成片峰值，余量只能在编码器入口这一侧留。
# ★★ 2026-10-03 曾把默认值由 −1.7 改成 −3.5；**2026-10-05 改回「−1.7 起步 + 编码后复核闭环」**（见下）。
#   历史与依据（保留，别丢）：
#   · 那 0.5 dB 余量是按**一部片子**标定的（AAC 过冲 0.08–0.22 dB）。全量 43 部成片扫描（loudnorm input_tp，4× 过采样）
#     显示**过冲最高到 +1.66 dB**，余量严重不足：19/43 部超 −1.2 dBTP，其中 6 部真峰值为正（实际削波）。
#   · 于是把 TP 目标从 −1.7 收紧到 −3.5，峰值确实压下去了（halftone-dossier −1.7→+0.43、−3.5→−3.26；
#     game-show −0.22→−2.00；pictogram-motion +0.28→−0.21），但**代价是响度**：
#     TP 目标每收紧 1 dB，高 LRA 的 mix 上 loudnorm 就会放弃 linear 回落 dynamic，输出响度被 TP 钳住而**掉约 0.7 LU**。
#     实测 silkscreen-poster（mix LRA 12.20）：TP −1.7 → 成片 −14.67 LUFS；TP −3.5 → **−16.05（出规格）**。
#   · 更糟的是 −3.5 **也不保证达标**：pictogram-motion 要 TP≈−3.2/−4.5 才过，而那时响度已掉出 −14±1。
#   ⇒ 结论：**没有万能的固定余量** —— 留少了峰值超标，留多了响度出窗。正解是**从最保响度的 −1.7 起步 + 编码后复核闭环**：
#     先按 −1.7 编一次，量成片真峰值（loudnorm input_tp，4× 过采样）与响度（input_i）：
#       · 两条都达标 ⇒ 就此产出（**只编码一次**，且与改动前 −1.7 的输出逐字节一致）；
#       · 真峰值超标 ⇒ 把 TP 目标下调 LEMO_LN_TP_STEP 重编，**只重做音频**（视频流 -c:v copy 复用），最多 LEMO_LN_TP_TRIES 档；
#       · 真峰值一旦达标就收手（响度只会随 TP 下行更差）；若此时响度已出窗 ⇒ 明确报「两条口径无法同时满足」并列出每一档实测值。
#   为什么起点是 −1.7 而不是 −3.5：−1.7 是**保响度**的一档，且大多数片子在 −1.7 就同时达标（过冲多为 0.1–0.5 dB）；
#   复核闭环只在**不达标时**才付重编的代价。从 −3.5 起步则一定牺牲响度，且**降下去回不了头**。
#   ⚠️ 步长为什么取 0.25 而不是 0.5：AAC 过冲对 TP 目标**非单调**，粗步长会漏掉可行的中间档 ——
#     实测 silkscreen-poster：TP −1.7 峰值 −1.10（超）、TP −2.2 响度 −15.07（出窗），但 **TP −1.95 两条都达标**；
#     0.5 步长会跳过 −1.95 而误判「救不了」。
#   环境变量（都可覆盖，便于做实验）：LEMO_LN_TP（起点，默认 −1.7）、LEMO_LN_TP_STEP（步长，默认 0.25）、
#   LEMO_LN_TP_TRIES（最多几档，默认 8）、LEMO_VCOPY=1（视频流不重编、直接 -c:v copy，只重做音频）。
LN_TP="${LEMO_LN_TP:--1.7}"
LN_TP_STEP="${LEMO_LN_TP_STEP:-0.25}"
LN_TP_TRIES="${LEMO_LN_TP_TRIES:-8}"
case "$LN_TP_TRIES" in ''|*[!0-9]*) die "LEMO_LN_TP_TRIES must be a positive integer, got '$LN_TP_TRIES'";; esac
[ "$LN_TP_TRIES" -ge 1 ] || die "LEMO_LN_TP_TRIES must be >= 1, got '$LN_TP_TRIES'"
case "$LN_TP_STEP" in ''|*[!0-9.]*) die "LEMO_LN_TP_STEP must be a number, got '$LN_TP_STEP'";; esac
# ★ AAC 码率（2026-10-03 新增，可覆盖）：`LEMO_ABR=320k ./mux.sh ...` —— **默认仍 256k**。
#   为什么留这个开关：实测码率对真峰值有影响，但**影响不单调**，所以不能拿它当「一键修复」：
#     · 固定 TP=−3.5 时，320k 在 8 个可测风格上**全部更好或持平**（halftone-dossier +1.06 dB、
#       paper-popup +0.95 dB，其余 +0.03~0.24），响度不变（±0.02 LU）—— 看着像稳赚；
#     · 但换个 TP 就翻盘：`pictogram-motion` 在 TP=−4.5 下 **256k 给 −1.49（达标）、
#       320k 反而给 −1.06（超标）**。
#   ⇒ 码率是「多一个可调维度」，不是「更优的固定值」。默认保持 256k 不动（也不动体积）；
#     真要治那些顽固素材，需要「编码后复测真峰值 → 不过就调参重试」的循环，本脚本尚未实现。
ABR="${LEMO_ABR:-256k}"

# 第一遍：量响度
[ -n "$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of csv=p=0 "$A" 2>/dev/null)" ] || die "no audio stream in '$A' (is it really the mixed audio file?)"
M=$(ffmpeg -hide_banner -nostats -progress pipe:2 -i "$A" -af loudnorm=I=-14:TP=$LN_TP:LRA=11:print_format=json -f null - 2>&1) || die "ffmpeg cannot read the audio '$A': $(echo "$M" | tail -2)"
wav_truncated "$A" && die "the WAV file '$A' is cut off: its header promises more audio than the file contains (was the write interrupted?)"
# 解码器/解封装器的日志行都以 [name @ 0x…] 开头；里面有错误字样，除了下面那三句流式 WAV 的固定提示，都算文件坏了（响度会是 -inf，但那不是"静音"）
ERRS=$(echo "$M" | grep -E '^\[' | grep -iE 'error|invalid|corrupt|header missing|overread|truncat|incomplete')
BENIGN='Ignoring maximum wav data size|Packet corrupt \(stream = [0-9]+, dts = NOPTS\)|corrupt input packet in stream [0-9]+'
BAD=$(echo "$ERRS" | grep -vE "$BENIGN" | head -2)
[ -z "$BAD" ] || die "the audio '$A' is damaged; ffmpeg reported while decoding it:
$BAD"
# 实际解出多少秒对比容器声称的；容器时长是 ffmpeg 自己"从码率估的"时不可靠，不比
# 注意：loudnorm 动态模式有约 3 s 前瞻缓冲，这段不计入第一遍 -progress 的 out_time（实测偏差恒为 2.9 s，与文件长度无关）。
# 直接拿它当"实际解码时长"会把任何短于 58 s 的音频（容差 = max(时长×5%, 0.15)）误判成"损坏或截断"并拒绝出片 —— 上游 bug。
# 默认改用一次不带 loudnorm 的廉价解码独立测真实解码时长；LEMO_STRICT_UPSTREAM=1 时恢复上游行为，便于逐字节对比。
if [ "${LEMO_STRICT_UPSTREAM:-}" = "1" ]; then
  DEC=$(echo "$M" | grep '^out_time=' | tail -1 | cut -d= -f2 | awk '{ if ($0 ~ /^-/ || $0 !~ /:/) print 0; else { split($0, p, ":"); print p[1] * 3600 + p[2] * 60 + p[3] } }')
else
  DEC=$(ffmpeg -hide_banner -nostats -progress pipe:2 -i "$A" -map 0:a:0 -f null - 2>&1 | grep '^out_time=' | tail -1 | cut -d= -f2 | awk '{ if ($0 ~ /^-/ || $0 !~ /:/) print 0; else { split($0, p, ":"); print p[1] * 3600 + p[2] * 60 + p[3] } }')
fi
CONT=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$A" 2>/dev/null | head -1)
if ! echo "$M" | grep -q 'Estimating duration from bitrate' && awk -v d="${DEC:-0}" -v c="${CONT:-0}" 'BEGIN { tol = c * 0.05 > 0.15 ? c * 0.05 : 0.15; exit !(c + 0 > 0 && c - d > tol) }'; then
  die "only ${DEC:-0} s of the ${CONT} s that '$A' claims could be decoded: the file is damaged or cut off"
fi
[ -z "$ERRS" ] || echo "mux.sh: note: ffmpeg complained about the header/ending of '$A' (typical of a WAV streamed with 'ffmpeg … -f wav -', whose length is a placeholder), but all ${DEC:-0} s decoded; continuing" >&2
J=$(echo "$M" | sed -n '/{/,/}/p')
g() { echo "$J" | grep "\"$1\"" | sed 's/.*: "\(.*\)".*/\1/'; }
NORM=1
for k in input_i input_tp input_lra input_thresh target_offset; do
  case "$(g $k)" in ''|*inf*|*nan*) NORM=0;; esac
done
[ "$NORM" = 1 ] || echo "mux.sh: warning: the audio is silent or quieter than -70 LUFS, so loudness normalisation was skipped" >&2

# 从一份 loudnorm 的 JSON 里取字段（g 取第一遍那份；jget 取任意一份）。
jget() { echo "$1" | grep "\"$2\"" | sed 's/.*: "\(.*\)".*/\1/'; }
# 给定 TP 目标，拼出第二遍的 loudnorm 滤镜串。
# 测量值（I/TP/LRA/thresh）与 TP 目标无关，但 target_offset **依赖** TP（实测 silkscreen：−1.7→1.08，−3.5→2.08）
# ⇒ 换 TP 必须重跑第一遍拿 offset（只多一次音频解码，不编码）。
ln_for_tp() {
  if [ "$1" = "$LN_TP" ]; then
    _i=$(g input_i); _t=$(g input_tp); _l=$(g input_lra); _th=$(g input_thresh); _o=$(g target_offset)
  else
    _j=$(ffmpeg -hide_banner -nostats -i "$A" -af loudnorm=I=-14:TP=$1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/{/,/}/p')
    _i=$(jget "$_j" input_i); _t=$(jget "$_j" input_tp); _l=$(jget "$_j" input_lra); _th=$(jget "$_j" input_thresh); _o=$(jget "$_j" target_offset)
  fi
  echo "loudnorm=I=-14:TP=$1:LRA=11:measured_I=$_i:measured_TP=$_t:measured_LRA=$_l:measured_thresh=$_th:offset=$_o:linear=true"
}

# 音频比画面短就补静音。
# ⚠️ 两处边界（都在 2026-10-01 用 778 帧的真实成片实测过，勿改回去）：
#   ① 门槛必须远小于一帧。原来只在「音频比画面短 0.02 s 以上」才补，而 0.02 s 比一帧（1/24 ≈ 0.0417 s）还小，
#      却比某些 demo 的真实缺口大：urban-sketch 的 mix.wav 是 32.400 s、画面容器时长 32.413411 s，只差 0.0134 s，
#      落进「不补」的缝里 ⇒ -shortest 把第 778 帧切掉（成片 777 帧）。
#   ② 补的目标必须是「画面长度 + 一帧」，不能恰好等于画面长度。实测：把 32.400 s 的音频补到恰好 VD=32.413411 s，
#      成片仍然只有 777 帧；补到 VD + 1/FPS 才稳定拿到 778 帧。只降门槛不补余量是修不好的。
#   音频本来就不比画面短时什么都不做（保持原语义）。
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null | head -1; }
VD=$(dur "$V"); AD=$(dur "$A"); PAD=""
if awk -v a="$AD" -v v="$VD" 'BEGIN { exit !(a + 0 > 0 && v + 0 > 0 && a + 0 < v - 1e-6) }'; then
  PD=$(awk -v v="$VD" -v f="$FPS" 'BEGIN { printf "%.6f", v + 1 / f }')
  PAD=",apad=whole_dur=$PD"
  echo "mux.sh: note: the audio ($AD s) is shorter than the video ($VD s); padding it with silence to $PD s (one frame past the video, so -shortest cannot clip the last frame)" >&2
fi

if [ "$GR" = "0" ]; then VF="fps=$FPS"; else VF="fps=$FPS,noise=c0s=$GR:allf=t"; fi
if [ "${LEMO_COLOR:-}" = "bt709" ]; then
  VF="$VF,scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709"
  CARGS="-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709"
else
  VF="$VF,format=yuv420p"; CARGS=""
fi
# 视频编码器：**未设 LEMO_VENC ⇒ 走 GPU 的 h264_nvenc**（用户硬规则：渲染/合成一律 GPU 优先）；
# 显式 libx264 才走 CPU；其它值**报错退出**，绝不静默回落 libx264
# （否则把 h264_nvenc 打成 h264_nven 会以为在用显卡、实际走 CPU）。
# NVENC 的 cq 数值越小画质越高、体积越大（LEMO_NVENC_CQ 可调，默认 23）：
#   cq 23 ≈ 对齐上游 libx264 -crf 19（实测体积 0.99x、画质持平、约快 2.7x）
#   cq 19 画质更高（SSIM +0.002 / PSNR +3.4 dB）但体积约 1.85x
case "${LEMO_VENC:-}" in
  ''|h264_nvenc) VARG="-c:v h264_nvenc -preset p5 -profile high -rc vbr -cq ${LEMO_NVENC_CQ:-23} -b:v 0";;
  libx264) VARG="-c:v libx264 -preset slow -crf 19";;
  *) die "LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '$LEMO_VENC'. Not falling back to the CPU encoder silently: a typo would look like GPU encoding while libx264 does the work.";;
esac
# ── 编码 + 复核闭环（见文件头 / 上面 LN_TP 处的说明）─────────────────────────────
# 从 LN_TP 起步编一次，量成片的真峰值与响度；真峰值没达标就按 LN_TP_STEP 下调 TP 目标重编
# （重编只重做音频，视频流 -c:v copy 复用，不重编视频）。★ 达标的片子只编码一次。
# 静音的片子不归一、也无可复核的响度 ⇒ 不重试。
[ "$NORM" = 1 ] || LN_TP_TRIES=1
VREF="$V"; FIRST_COPY=0
[ "${LEMO_VCOPY:-}" = "1" ] && FIRST_COPY=1
# 编码一次：$1 = TP 目标，$2 = 输出路径，$3 = 1 表示视频流直接 -c:v copy 复用 $VREF（0 = 按 $VF 重编）
mux_once() {
  if [ "$NORM" = 1 ]; then _ln=$(ln_for_tp "$1"); else _ln="anull"; fi
  if [ "$3" = "1" ]; then
    ffmpeg -y -loglevel error -i "$VREF" -i "$A" \
      -filter_complex "[1:a]$_ln,aresample=48000$PAD[a]" \
      -map 0:v -map "[a]" -c:v copy -c:a aac -b:a $ABR -movflags +faststart -shortest "$2"
  else
    # shellcheck disable=SC2086  (CARGS / VARG 要按空格拆成多个参数；默认为空)
    ffmpeg -y -loglevel error -i "$V" -i "$A" \
      -filter_complex "[0:v]$VF[v];[1:a]$_ln,aresample=48000$PAD[a]" \
      -map "[v]" -map "[a]" $VARG -r "$FPS" $CARGS -c:a aac -b:a $ABR -movflags +faststart -shortest "$2"
  fi
}
# 量成片：真峰值取 loudnorm 的 4× 过采样 input_tp（交付口径），响度取同一次解码的 input_i。回显 "I TP"。
# ★ -vn（2026-10-06 性能审计）：这条只跑音频滤镜链（-af loudnorm）、输出到 -f null，**不读视频**。
#   不加 -vn 时 ffmpeg 会按默认映射把 h264 视频流也解码一遍（实测 `Stream #0:0 -> #0:0 h264 -> wrapped_avframe`），
#   白花 2.3 s/次（148 s 1080p 成片实测 7003 ms → 4720 ms），而读数逐位不变（input_i/-tp/-lra/thresh/offset 全同）。
#   闭环会调它 1~8 次，省下的时间按次数翻倍。★ 这里没有 -map 0:v，加 -vn 不冲突。
# ★★ 判据（2026-10-06 修，勿回退）：本函数**必须能区分「量出来了」与「没量出来」** ——
#   量出来了才回显 "I TP"；**没量出来就 `return 1` 且不回显读数**。判据两条，任一成立即「没量出来」：
#   ① ffmpeg 退出码 ≠ 0；② input_i / input_tp 有一个没解析出来（空串）。
#   ⚠️ 退出码必须**这样**取：`_all=$(ffmpeg … 2>&1)` 让 ffmpeg **独占**命令替换（于是 $? 就是它自己的），
#     再对变量做 sed。原来写成 `_j=$(ffmpeg … 2>&1 | sed -n '/{/,/}/p')` —— 管道末段是 sed，
#     **ffmpeg 的退出码被吃掉**（恒为 0），失败时只是解析出两个空串，看起来与「读数解析不出」无从区分，
#     闭环便把它当成「不达标」⇒ **白跑满 8 档全片音频重编**（每档一次），最后交付的还是第 1 档。
#     实测（2026-10-06，30 s 成片，用一个只在这次调用上 exit 1 的 ffmpeg 桩注入）：8 档 / 23.6 s。
#   ⚠️ 别把「读数是 -inf/nan」也当失败：那是**量出来了**的合法结果（静音片），此时 NORM=0、本函数只被调 1 次。
measure_film() {
  _all=$(ffmpeg -hide_banner -nostats -vn -i "$1" -af loudnorm=I=-14:TP=-1.7:LRA=11:print_format=json -f null - 2>&1); _mrc=$?
  _j=$(echo "$_all" | sed -n '/{/,/}/p')
  _mi=$(jget "$_j" input_i); _mp=$(jget "$_j" input_tp)
  [ "$_mrc" = 0 ] && [ -n "$_mi" ] && [ -n "$_mp" ] || return 1
  echo "$_mi $_mp"
}
# 临时文件名：把后缀插在扩展名之前（**必须保留扩展名**，否则 ffmpeg 认不出封装器）。
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
TP_TRY="$LN_TP"; ATTEMPT=0; MFAIL=0; BEST_R=""; BEST_S=""; BEST_TP=""; BEST_I=""; BEST_P=""; BEST_OUT=""; TRIES=""; TEMPS=""
while [ "$ATTEMPT" -lt "$LN_TP_TRIES" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" = 1 ]; then OUT="$O"; else OUT=$(tmp_out "$O" "try$ATTEMPT"); TEMPS="$TEMPS $OUT"; fi
  if [ "$ATTEMPT" = 1 ]; then
    mux_once "$TP_TRY" "$OUT" "$FIRST_COPY" || { rm -f "$OUT" $TEMPS "$VIDOUT"; die "ffmpeg failed while writing '$OUT' (its message is above)"; }
  else
    [ "$FIRST_COPY" = 1 ] || [ -f "$VIDOUT" ] \
      || ffmpeg -y -loglevel error -i "$O" -map 0:v -c:v copy -an "$VIDOUT" \
      || { rm -f $TEMPS "$VIDOUT"; die "could not extract the video stream of '$O' for a cheaper audio-only retry"; }
    # ★★ 必须把 VREF 指到刚抽出的 $VIDOUT —— 否则重试那一档会 `-c:v copy` 复制 **$V（未滤镜的原始视频）**，
    #    把 mux 层的 fps 转换与颗粒（$VF 里的 `fps=…,noise=…`）**整层丢掉**，而这一档是要交付的。
    #    实测：不指过去时，重试档的视频流与首档**不一致**（丢颗粒）；指过去后两者逐字节相同。
    # ★ 但**只在真抽出了 $VIDOUT 时才指**：LEMO_VCOPY=1（FIRST_COPY=1）时上面那行**不抽**，
    #   此时 VREF 保持 $V —— 那正是首档用的源，重试与首档同源、语义一致。
    #   （修过一个真 bug：无条件 VREF="$VIDOUT" 会让 LEMO_VCOPY=1 的重试指向不存在的文件而 die。）
    if [ -f "$VIDOUT" ]; then VREF="$VIDOUT"; fi
    mux_once "$TP_TRY" "$OUT" 1 || { rm -f $TEMPS "$VIDOUT"; die "ffmpeg failed while re-muxing '$OUT' (its message is above)"; }
  fi
  [ -s "$OUT" ] || { rm -f $TEMPS "$VIDOUT"; die "no output was written to '$OUT'"; }
  # ★ 量不出来（measure_film 的 ffmpeg 失败 / 读数没解析出来）**不等于「不达标」**：读数无效时再降 TP 重编毫无依据
  #   （原来正是这里把空读数当「不达标」⇒ 白跑满 8 档、每档一次全片音频编码，交付的却仍是第 1 档）。
  #   所以这里**明确警告一次并停止重试**，然后照旧收尾：第 1 档成片就写在 $O、下面 BEST 记的也是它
  #   ⇒ 最终交付的文件、stdout、退出码都与「原来跑满 8 档」时**逐位相同**，只是不再付那 7 次白编的代价。
  #   ⚠️ 不改「达标」与「真不达标（读数有效）」两条路径的任何行为，也不新增 die 路径（原来会 die 的仍 die）。
  if _M=$(measure_film "$OUT"); then
    OI="${_M%% *}"; OP="${_M##* }"; MFAIL=0
  else
    OI=""; OP=""; MFAIL=1
    echo "mux.sh: warning: could NOT measure the film '$OUT' (ffmpeg failed while re-reading it with loudnorm, or its readout did not parse): the loudness / true-peak check was SKIPPED and this film is UNVERIFIED. Not lowering the TP target: a retry would have no valid reading to steer by. Stopping after this attempt." >&2
  fi
  TP_OK=0; I_OK=0
  awk -v p="$OP" 'BEGIN { exit !(p + 0 <= -1.2) }' && TP_OK=1
  awk -v i="$OI" 'BEGIN { d = i + 0 + 14; if (d < 0) d = -d; exit !(d <= 1.0) }' && I_OK=1
  TRIES="$TRIES$TP_TRY:($OI,$OP) "
  echo "mux.sh: attempt $ATTEMPT: TP target $TP_TRY -> film true peak $OP dBTP, loudness $OI LUFS" >&2
  # 记下目前最好的一档：r 越小越好（0 = 两条都达标），同 r 内 s（响度偏离 / 峰值超出）越小越好
  _R=0; [ "$TP_OK" = 1 ] || _R=2; [ "$I_OK" = 1 ] || _R=$((_R + 1))
  if [ "$_R" -le 1 ]; then _S=$(awk -v i="$OI" 'BEGIN { d = i + 14; if (d < 0) d = -d; print d }')
  else _S=$(awk -v p="$OP" 'BEGIN { d = p + 1.2; if (d < 0) d = 0; print d }'); fi
  if [ -z "$BEST_R" ] || awk -v r1="$_R" -v s1="$_S" -v r0="$BEST_R" -v s0="$BEST_S" 'BEGIN { exit !(r1 < r0 || (r1 == r0 && s1 < s0)) }'; then
    BEST_R="$_R"; BEST_S="$_S"; BEST_TP="$TP_TRY"; BEST_I="$OI"; BEST_P="$OP"; BEST_OUT="$OUT"
  fi
  # 量不出来 ⇒ 立刻收手：重编没有任何读数可依（原来会白跑满 8 档）。
  # 否则真峰值一旦达标就收手：响度只会随 TP 下行更差（实测单调），再降没有意义。
  [ "$MFAIL" = 1 ] && break
  [ "$TP_OK" = 1 ] && break
  TP_TRY=$(awk -v t="$TP_TRY" -v s="$LN_TP_STEP" 'BEGIN { printf "%.3f", t - s }')
done
[ "$BEST_OUT" = "$O" ] || mv -f "$BEST_OUT" "$O"
rm -f $TEMPS "$VIDOUT"
echo "$O"
# ebur128 出人看的 I / LRA / Peak；astats 串在同一条 -af 链里（同一次解码，不额外花钱）提供 6 位小数的峰值。
# ★ -vn（2026-10-06 性能审计）：同上，纯音频滤镜链 + -f null，不需要视频；
#   不加时白解码一遍 h264（148 s 1080p 实测 3641 ms → 1561 ms），I/LRA/Peak/astats 读数逐位不变。
#   ★ 上面 :235 那句抽视频流的 `-map 0:v -c:v copy -an` 和 mux_once 的两条编码命令**绝不能**加 -vn。
R=$(ffmpeg -hide_banner -nostats -vn -i "$O" -af ebur128=peak=true,astats=measure_perchannel=none -f null - 2>&1 | grep -E "^\s+(I|LRA|Peak):|Peak level dB" | head -6)
echo "$R"
if [ "$NORM" = 1 ]; then
  OI=$(echo "$R" | awk '$1 == "I:" { print $2 }')
  OP=$(echo "$R" | awk '$1 == "Peak:" { print $2 }')
  # 判据用 astats 的 6 位小数读数，不用 ebur128 的 1 位小数 Peak（见文件头说明）。
  # astats 报的是采样峰值，它是真峰值的下界 —— 判据因此不会误报（不会把达标的片子判成超标）。
  OPX=$(echo "$R" | awk -F': ' '/Peak level dB/ { print $2; exit }')
  [ -n "$OPX" ] || OPX="$OP"
  # 这里的 −1.2 是**成片交付目标**（量的是编码后的文件），不是 loudnorm 的 TP 目标（LN_TP）。
  # 两者刻意留差：那正是留给 AAC 过冲的余量。别把这里也改成 LN_TP —— 那等于把交付标准偷偷放宽。
  #
  # ★★ 真峰值复核（2026-10-03 立，2026-10-05 并入闭环）：交付线（−1.2 dBTP）定义在**真峰值**上，
  #   而上面 astats 报的是**采样峰值**（下界，只查它会漏报：实测 pixel-rpg 差 1.62 dB）。
  #   ⇒ 真峰值取闭环里同一条 loudnorm（4× 过采样）的读数 —— 量的是最终产出（胜出那一档已 mv 成 $O），
  #     口径与上面 measure_film 完全一致，且**不额外再解一遍**。
  OPT="$BEST_P"
  [ -n "$OPT" ] || OPT="$OPX"
  if awk -v i="$OI" -v p="$OPX" -v t="$OPT" 'BEGIN { exit !(i + 0 < -15 || i + 0 > -13 || p + 0 > -1.2 || t + 0 > -1.2) }'; then
    echo "mux.sh: warning: the film missed the target (-14 LUFS, true peak <= -1.2 dB): measured $OI LUFS, true peak $OPT dBTP (sample peak $OPX dB; ebur128 1-decimal readout $OP dB). The mix is probably clipping or has very hot peaks: lower it and tame the peaks, then mux again" >&2
    # ★ 量不出来（MFAIL=1）时**不要**打这句：它是在断言「试过的每一档的实测值」，可那一轮根本没读到任何读数
    #   （实测会印出 `-1.7:(,) -1.950:(,) …` 这种空壳，误导读者以为试过 8 档）。上面「量不出来」那一支已单独警告过。
    [ "$MFAIL" = 1 ] || [ "$BEST_R" = 0 ] || echo "mux.sh: warning: the two delivery lines cannot BOTH be met for this film: the true peak only comes under -1.2 dBTP at TP target $BEST_TP, but there the loudness is $BEST_I LUFS (outside -14 +/- 1 LU). Kept the best of $ATTEMPT tries; tried (loudness,true peak) per TP target: $TRIES" >&2
  fi
fi
exit 0
