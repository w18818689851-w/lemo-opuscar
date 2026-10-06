#!/bin/sh
# 720p web cuts for the gallery (served by GitHub Pages as video/mp4, which Safari needs).
# A cut is made when it doesn't exist yet or when its film is newer; a failing ffmpeg stops the run with exit 1.
cd "$(dirname "$0")/.."
mkdir -p .release/web
fail=0
# 视频编码器：**未设 LEMO_VENC ⇒ 走 GPU 的 h264_nvenc**（用户硬规则：渲染一律 GPU 优先）；
# 显式 libx264 才走 CPU；其它值报错退出，绝不静默回落 CPU。
case "${LEMO_VENC:-}" in
  ''|h264_nvenc) VARG="-c:v h264_nvenc -preset p5 -profile high -rc vbr -cq 29 -b:v 0";;
  libx264) VARG="-c:v libx264 -preset slow -crf 24 -maxrate 2M -bufsize 4M";;
  *) echo "web_cuts.sh: LEMO_VENC must be h264_nvenc or libx264, or unset (which means h264_nvenc, the GPU encoder), got '$LEMO_VENC'. Not falling back to the CPU encoder silently: a typo would look like GPU encoding while libx264 does the work." >&2; exit 1;;
esac
webcut() {   # webcut <film> <slug>
  src=$1; out=.release/web/$2.mp4
  [ -f "$out" ] && [ ! "$src" -nt "$out" ] && return 0
  if ffmpeg -v error -y -i "$src" -vf "scale=-2:720:flags=lanczos" $VARG -pix_fmt yuv420p \
    -c:a aac -b:a 128k -movflags +faststart -f mp4 "$out.part"; then mv "$out.part" "$out"; echo "$2 $(du -h "$out" | cut -f1)"
  else rm -f "$out.part"; echo "✗ $2: ffmpeg could not make the web cut of $src" >&2; fail=1; fi
}
for f in styles/*/STYLE.md; do
  s=$(basename "$(dirname "$f")")
  [ -f "styles/$s/$s.mp4" ] && webcut "styles/$s/$s.mp4" "$s"
done
for f in .release/films/*.mp4; do      # feature films (not a style), e.g. opuscar98
  [ -f "$f" ] || continue
  s=$(basename "$f" .mp4)
  [ -f "styles/$s/STYLE.md" ] || webcut "$f" "$s"
done
du -sh .release/web
[ "$fail" = 0 ] || exit 1
