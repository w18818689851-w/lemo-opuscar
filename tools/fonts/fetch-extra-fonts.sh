#!/bin/bash
# 补充：index.html 里直接引用 fonts/ 的 7 个 demo（共 18 个文件）
# 复用与 fetch-fonts.sh 相同的下载/校验逻辑，幂等可重跑
# 由 tools/fetch-fonts.sh 的阶段5 调用（不单独用）。
#   入参（环境变量）：
#     LEMO_LIB    仓库根（默认取当前目录）
#     FONT_CACHE  源文件缓存目录
#     ONLY_SLUGS  空格分隔的 slug 白名单；留空 = 全部
set -u
export PATH=/usr/local/bin:$PATH
LIB="${LEMO_LIB:-$PWD}"
CACHE="${FONT_CACHE:-/opt/fontsrc-cache}"
STAGE="${FONT_STAGE_EXTRA:-/opt/fontstage-extra}"
ONLY_SLUGS="${ONLY_SLUGS:-}"
mkdir -p "$CACHE" "$STAGE"
OK=0; FAIL=0
: > /tmp/font_extra_failed.txt

wanted(){ [ -z "$ONLY_SLUGS" ] && return 0; case " $ONLY_SLUGS " in *" $1 "*) return 0;; *) return 1;; esac; }

MIRRORS=(
  "https://cdn.jsdelivr.net/gh/google/fonts@main"
  "https://raw.githubusercontent.com/google/fonts/main"
  "https://raw.gitmirror.com/google/fonts/main"
)
magic(){ head -c 4 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n'; }
validate(){
  local f="$1" sz m
  [ -s "$f" ] || return 1
  sz=$(stat -c%s "$f"); [ "$sz" -gt 2048 ] || return 1
  m=$(magic "$f")
  case "$m" in 00010000|74727565|4f54544f|74746366|774f4632|774f4646) return 0;; *) return 1;; esac
}
urlenc(){ printf '%s' "$1" | sed 's/\[/%5B/g; s/\]/%5D/g; s/,/%2C/g; s/ /%20/g'; }
cache_repo(){
  local p="$1" c
  c="$CACHE/$(printf '%s' "$p" | sed 's/\[/_/g; s/\]/_/g; s/,/_/g; s|/|__|g')"
  validate "$c" && { echo "$c"; return 0; }
  local m enc; enc=$(urlenc "$p")
  for m in "${MIRRORS[@]}"; do
    if curl -fsSL --retry 2 --retry-delay 1 --max-time 180 -o "$c" "$m/$enc" 2>/dev/null && validate "$c"; then
      echo "$c"; return 0
    fi
    rm -f "$c"
  done
  return 1
}

# 目标文件|google/fonts 仓库路径
while IFS='|' read -r tgt src; do
  [ -z "${tgt:-}" ] && continue
  case "$tgt" in \#*) continue;; esac
  wanted "$(printf '%s' "$tgt" | sed -n 's|^styles/\([^/]*\)/.*|\1|p')" || continue
  if validate "$LIB/$tgt"; then echo "  跳过(已存在) $tgt"; OK=$((OK+1)); continue; fi
  mkdir -p "$(dirname "$LIB/$tgt")"
  c=$(cache_repo "$src") || { echo "❌ 源获取失败: $tgt  <- $src"; echo "$tgt|$src|源获取失败" >> /tmp/font_extra_failed.txt; FAIL=$((FAIL+1)); continue; }
  cp -f "$c" "$LIB/$tgt" && chown lemo:lemo "$LIB/$tgt" 2>/dev/null
  if validate "$LIB/$tgt"; then
    echo "  ✅ $tgt  ($(stat -c%s "$LIB/$tgt") 字节)"
    OK=$((OK+1))
  else
    echo "❌ 落盘校验失败: $tgt"; rm -f "$LIB/$tgt"
    echo "$tgt|$src|落盘校验失败" >> /tmp/font_extra_failed.txt; FAIL=$((FAIL+1))
  fi
done <<'EOF'
styles/iso-infographic/demo/fonts/Jost.ttf|ofl/jost/Jost[wght].ttf
styles/living-screencast/demo/fonts/Inter.ttf|ofl/inter/Inter[opsz,wght].ttf
styles/living-screencast/demo/fonts/JetBrainsMono-var.ttf|ofl/jetbrainsmono/JetBrainsMono[wght].ttf
styles/living-screencast/demo/fonts/Newsreader-VF.ttf|ofl/newsreader/Newsreader[opsz,wght].ttf
styles/living-screencast/demo/fonts/Newsreader-Italic-VF.ttf|ofl/newsreader/Newsreader-Italic[opsz,wght].ttf
styles/one-line/demo/fonts/Caveat.ttf|ofl/caveat/Caveat[wght].ttf
styles/one-line/demo/fonts/Sacramento-Regular.ttf|ofl/sacramento/Sacramento-Regular.ttf
styles/urban-sketch/demo/fonts/Caveat.ttf|ofl/caveat/Caveat[wght].ttf
styles/urban-sketch/demo/fonts/ReenieBeanie.ttf|ofl/reeniebeanie/ReenieBeanie.ttf
styles/whiteboard/demo/fonts/ArchitectsDaughter-Regular.ttf|ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf
styles/paper-lantern/demo/fonts/LongCang.ttf|ofl/longcang/LongCang-Regular.ttf
styles/paper-lantern/demo/fonts/MaShanZheng.ttf|ofl/mashanzheng/MaShanZheng-Regular.ttf
styles/paper-lantern/demo/fonts/NotoSerifSC.ttf|ofl/notoserifsc/NotoSerifSC[wght].ttf
styles/paper-lantern/demo/fonts/ZhiMangXing.ttf|ofl/zhimangxing/ZhiMangXing-Regular.ttf
styles/pictogram-motion/demo/fonts/DMMono-Medium.ttf|ofl/dmmono/DMMono-Medium.ttf
styles/pictogram-motion/demo/fonts/InterTightwght.ttf|ofl/intertight/InterTight[wght].ttf
styles/pictogram-motion/demo/fonts/NotoSansJPwght.ttf|ofl/notosansjp/NotoSansJP[wght].ttf
styles/pictogram-motion/demo/fonts/NotoSansSCwght.ttf|ofl/notosanssc/NotoSansSC[wght].ttf
EOF
echo
echo "补充字体：成功 $OK / 失败 $FAIL"
