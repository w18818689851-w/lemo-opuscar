#!/bin/bash
# ============================================================================
# lemo-opuscar 全仓字体补齐脚本  (可重复运行 / idempotent)
#   1) 扫描 styles/*/demo/fonts/fonts.css 得到全部字体引用
#   2) 按内置映射表从 google/fonts 取源文件（jsDelivr → raw.githubusercontent → gitmirror）
#   3) 需要 woff2 的用 fontTools+brotli 现场转换；需要静态实例的用 varLib.instancer 切片
#   4) 逐个校验：大小 > 2KB 且文件头为合法字体魔数
#   5) 输出统计与失败清单到 $FONT_REPORT
#
# 为什么需要它：字体文件不入库（见 .gitignore：`styles/*/demo/fonts/**/*.ttf` /
#   `**/*.woff2`）——判据是「能不能由本仓内脚本重新生成」。本脚本就是那个脚本，
#   所以新克隆只要跑它就能把 41 个 demo 的字体补齐，不再依赖仓外文件。
#
# 覆盖的三种布局（合计 41 个 demo）：
#   · 阶段1-3  styles/<slug>/demo/fonts/fonts.css          —— 30 个 demo
#   · 阶段4    styles/<slug>/demo/fonts.css（Google 子集包）—— 4 个 demo
#   · 阶段5    index.html 里直接引用 fonts/ 的 demo         —— 7 个 demo
#   · 阶段6    全仓引用审计（只读）
#
# 依赖：fontTools + brotli 的 python 环境（见 $FONT_PY）、curl
# 用法：bash tools/fetch-fonts.sh                 # 全量
#       bash tools/fetch-fonts.sh --only woodcut  # 只补指定风格（可重复，空格分隔）
#       FONT_PY=.venv/bin/python bash tools/fetch-fonts.sh
# ============================================================================
set -u
export PATH=/usr/local/bin:$PATH

# 仓库根由脚本位置推导（不写死 /home/lemo/... 之类的主机绝对路径）
TOOLS="$(cd "$(dirname "$0")" && pwd)"
LIB="$(cd "$TOOLS/.." && pwd)"
HELPDIR="$TOOLS/fonts"                       # 随本脚本一起入库的 helper

CACHE="${FONT_CACHE:-/opt/fontsrc-cache}"    # 原始源文件缓存（按 repo 路径）
STAGE="${FONT_STAGE:-/opt/fontstage}"        # 产物缓存（按 name|op|src）
PY="${FONT_PY:-/opt/fonttools-venv/bin/python}"
REPORT="${FONT_REPORT:-/tmp/font_report.txt}"
FAILED="${FONT_FAILED:-/tmp/font_failed.txt}"
OKLOG="${FONT_OKLOG:-/tmp/font_ok.txt}"

# --only <slug> [<slug>...]：只处理这些风格（留空 = 全部）
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) shift; while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do ONLY="$ONLY $1"; shift; done ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（用法见 bash $0 --help）" >&2; exit 2 ;;
  esac
done
ONLY="${ONLY# }"
wanted(){ [ -z "$ONLY" ] && return 0; case " $ONLY " in *" $1 "*) return 0;; *) return 1;; esac; }

mkdir -p "$CACHE" "$STAGE"
: > "$FAILED"; : > "$OKLOG"

MIRRORS=(
  "https://cdn.jsdelivr.net/gh/google/fonts@main"
  "https://raw.githubusercontent.com/google/fonts/main"
  "https://raw.gitmirror.com/google/fonts/main"
)

# ---------------------------------------------------------------- 工具函数
magic(){ head -c 4 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n'; }

validate(){ # $1=file $2=期望类型(ttf|woff2|any)
  local f="$1" want="${2:-any}" sz m kind
  [ -s "$f" ] || return 1
  sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  [ "$sz" -gt 2048 ] || return 1
  m=$(magic "$f")
  case "$m" in
    00010000|74727565|4f54544f|74746366) kind=ttf ;;
    774f4632) kind=woff2 ;;
    774f4646) kind=woff ;;
    *) return 1 ;;
  esac
  [ "$want" = any ] && return 0
  [ "$kind" = "$want" ]
}

urlenc(){ printf '%s' "$1" | sed 's/\[/%5B/g; s/\]/%5D/g; s/,/%2C/g; s/ /%20/g'; }

fetch_repo(){ # $1=repo相对路径 $2=目标文件
  local p enc m
  p="$1"; enc=$(urlenc "$p")
  for m in "${MIRRORS[@]}"; do
    curl -fsSL --retry 2 --retry-delay 2 --max-time 180 -o "$2" "$m/$enc" 2>/dev/null \
      && [ -s "$2" ] && return 0
    rm -f "$2"
  done
  return 1
}

cache_repo(){ # $1=repo相对路径 -> 打印缓存文件路径
  local p c
  p="$1"
  c="$CACHE/$(printf '%s' "$p" | sed 's/\[/_/g; s/\]/_/g; s/,/_/g; s|/|__|g')"
  if validate "$c" any; then echo "$c"; return 0; fi
  if fetch_repo "$p" "$c" && validate "$c" any; then echo "$c"; return 0; fi
  rm -f "$c"; return 1
}

to_woff2(){ # $1=源 $2=目标
  "$PY" -c '
import sys
from fontTools.ttLib import TTFont
f=TTFont(sys.argv[1]); f.flavor="woff2"; f.save(sys.argv[2])
' "$1" "$2" 2>/dev/null
}

instance_ttf(){ # $1=源 $2=目标 $3=轴(wght=500)
  "$PY" -c '
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
f=TTFont(sys.argv[1])
axes={}
for kv in sys.argv[3].split(","):
    if "=" in kv:
        k,v=kv.split("="); axes[k]=float(v)
# updateFontNames=True 在部分字体上会因 STAT 表缺少对应 Axis Value 而抛
# ValueError: Cannot find Axis Values，故固定用 False，再手工写 OS/2.usWeightClass
instancer.instantiateVariableFont(f, axes, inplace=True, updateFontNames=False)
if "wght" in axes and "OS/2" in f:
    try: f["OS/2"].usWeightClass = int(round(axes["wght"]))
    except Exception: pass
f.save(sys.argv[2])
' "$1" "$2" "$3" 2>/dev/null
}

produce(){ # $1=name $2=opspec $3=repo路径 -> 打印产物路径
  local name="$1" op="$2" src="$3"
  local key out base tmp
  key=$(printf '%s|%s|%s' "$name" "$op" "$src" | md5sum | cut -c1-12)
  base=$(printf '%s' "$name" | sed 's/\[/_/g; s/\]/_/g')
  out="$STAGE/$key-$base"
  if validate "$out" any; then echo "$out"; return 0; fi
  local c
  c=$(cache_repo "$src") || return 1
  case "$op" in
    copy)   cp -f "$c" "$out" ;;
    w2)     to_woff2 "$c" "$out" ;;
    instw2:*) tmp="$STAGE/$key.tmp.ttf"
            instance_ttf "$c" "$tmp" "${op#instw2:}" || { rm -f "$tmp"; return 1; }
            to_woff2 "$tmp" "$out"; rm -f "$tmp" ;;
    inst:*) tmp="$STAGE/$key.tmp.ttf"
            instance_ttf "$c" "$tmp" "${op#inst:}" || { rm -f "$tmp"; return 1; }
            cp -f "$tmp" "$out"; rm -f "$tmp" ;;
    *) return 1 ;;
  esac
  validate "$out" any || { rm -f "$out"; return 1; }
  echo "$out"
}

# ---------------------------------------------------------------- 映射表
# 格式: 引用文件名|操作|google/fonts 仓库相对路径
#   操作 copy     直接拷贝 TTF
#   操作 w2       转成 woff2
#   操作 inst:轴   可变字体切片成静态 TTF
#   操作 instw2:轴 切片后再转 woff2
SPEC=$(mktemp)
cat > "$SPEC" <<'SPECEOF'
6xKtdSZaM9iE8KbpRA_hK1QNYuDyPw.woff2|w2|ofl/quicksand/Quicksand[wght].ttf
AlfaSlabOne-Regular.ttf|copy|ofl/alfaslabone/AlfaSlabOne-Regular.ttf
Allura-Regular.ttf|copy|ofl/allura/Allura-Regular.ttf
ArchitectsDaughter-Regular.ttf|copy|ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf
Archivo-VF.ttf|copy|ofl/archivo/Archivo[wdth,wght].ttf
B612-Bold.ttf|copy|ofl/b612/B612-Bold.ttf
B612-Regular.ttf|copy|ofl/b612/B612-Regular.ttf
B612Mono-Regular.ttf|copy|ofl/b612mono/B612Mono-Regular.ttf
BarlowSemiCondensed-Bold.ttf|copy|ofl/barlowsemicondensed/BarlowSemiCondensed-Bold.ttf
BarlowSemiCondensed-Medium.ttf|copy|ofl/barlowsemicondensed/BarlowSemiCondensed-Medium.ttf
BarlowSemiCondensed-SemiBold.ttf|copy|ofl/barlowsemicondensed/BarlowSemiCondensed-SemiBold.ttf
BigShouldersDisplay.ttf|copy|ofl/bigshouldersdisplay/BigShouldersDisplay[wght].ttf
BodoniModa-Italic-VF.ttf|copy|ofl/bodonimoda/BodoniModa-Italic[opsz,wght].ttf
BodoniModa-VF.ttf|copy|ofl/bodonimoda/BodoniModa[opsz,wght].ttf
Bricolage.ttf|copy|ofl/bricolagegrotesque/BricolageGrotesque[opsz,wdth,wght].ttf
Caveat-VF.ttf|copy|ofl/caveat/Caveat[wght].ttf
Cinzel-VF.ttf|copy|ofl/cinzel/Cinzel[wght].ttf
CormorantGaramond-Bold.ttf|inst:wght=700|ofl/cormorantgaramond/CormorantGaramond[wght].ttf
CormorantGaramond-Italic-VF.ttf|copy|ofl/cormorantgaramond/CormorantGaramond-Italic[wght].ttf
CormorantGaramond-Italic.woff2|w2|ofl/cormorantgaramond/CormorantGaramond-Italic[wght].ttf
CormorantGaramond-Medium.ttf|inst:wght=500|ofl/cormorantgaramond/CormorantGaramond[wght].ttf
CormorantGaramond-SemiBold.ttf|inst:wght=600|ofl/cormorantgaramond/CormorantGaramond[wght].ttf
CormorantGaramond-SemiBoldItalic.ttf|inst:wght=600|ofl/cormorantgaramond/CormorantGaramond-Italic[wght].ttf
CormorantGaramond-VF.ttf|copy|ofl/cormorantgaramond/CormorantGaramond[wght].ttf
CormorantSC-Medium.ttf|copy|ofl/cormorantsc/CormorantSC-Medium.ttf
CormorantSC-SemiBold.ttf|copy|ofl/cormorantsc/CormorantSC-SemiBold.ttf
CormorantSC.woff2|w2|ofl/cormorantsc/CormorantSC-Medium.ttf
DMSerifDisplay-Regular.ttf|copy|ofl/dmserifdisplay/DMSerifDisplay-Regular.ttf
DelaGothicOne-Regular.ttf|copy|ofl/delagothicone/DelaGothicOne-Regular.ttf
Fraunces.ttf|copy|ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf
GochiHand-Regular.ttf|copy|ofl/gochihand/GochiHand-Regular.ttf
IBMPlexMono-500.woff2|w2|ofl/ibmplexmono/IBMPlexMono-Medium.ttf
IBMPlexMono-600.woff2|w2|ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf
IBMPlexMono-Medium.ttf|copy|ofl/ibmplexmono/IBMPlexMono-Medium.ttf
IBMPlexMono-Regular.ttf|copy|ofl/ibmplexmono/IBMPlexMono-Regular.ttf
IBMPlexSans-400.woff2|instw2:wght=400|ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf
IBMPlexSans-600.woff2|instw2:wght=600|ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf
IBMPlexSans-700.woff2|instw2:wght=700|ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf
IBMPlexSansCondensed-600.woff2|w2|ofl/ibmplexsanscondensed/IBMPlexSansCondensed-SemiBold.ttf
IBMPlexSansCondensed-700.woff2|w2|ofl/ibmplexsanscondensed/IBMPlexSansCondensed-Bold.ttf
IMFeENsc28P.ttf|copy|ofl/imfellenglishsc/IMFeENsc28P.ttf
IMFellEnglish-Italic.ttf|copy|ofl/imfellenglish/IMFeENit28P.ttf
IMFellEnglish-Regular.ttf|copy|ofl/imfellenglish/IMFeENrm28P.ttf
IMFellEnglish.ttf|copy|ofl/imfellenglish/IMFeENrm28P.ttf
IMFellEnglishSC.ttf|copy|ofl/imfellenglishsc/IMFeENsc28P.ttf
Inter.ttf|copy|ofl/inter/Inter[opsz,wght].ttf
InterTight-var.woff2|w2|ofl/intertight/InterTight[wght].ttf
Italiana-Regular.ttf|copy|ofl/italiana/Italiana-Regular.ttf
JetBrainsMono-var.ttf|copy|ofl/jetbrainsmono/JetBrainsMono[wght].ttf
JosefinSans[wght].ttf|copy|ofl/josefinsans/JosefinSans[wght].ttf
Jost.ttf|copy|ofl/jost/Jost[wght].ttf
Kanit-BlackItalic.ttf|copy|ofl/kanit/Kanit-BlackItalic.ttf
Kanit-ExtraBoldItalic.ttf|copy|ofl/kanit/Kanit-ExtraBoldItalic.ttf
Kanit-SemiBoldItalic.ttf|copy|ofl/kanit/Kanit-SemiBoldItalic.ttf
LeagueGothic.ttf|copy|ofl/leaguegothic/LeagueGothic[wdth].ttf
LeagueSpartan.ttf|copy|ofl/leaguespartan/LeagueSpartan[wght].ttf
LilitaOne-Regular.ttf|copy|ofl/lilitaone/LilitaOne-Regular.ttf
Limelight-Regular.ttf|copy|ofl/limelight/Limelight-Regular.ttf
MaShanZheng-Regular.ttf|copy|ofl/mashanzheng/MaShanZheng-Regular.ttf
Newsreader-Italic-VF.ttf|copy|ofl/newsreader/Newsreader-Italic[opsz,wght].ttf
Newsreader-VF.ttf|copy|ofl/newsreader/Newsreader[opsz,wght].ttf
OldStandard-Bold.ttf|copy|ofl/oldstandardtt/OldStandard-Bold.ttf
OldStandard-Italic.ttf|copy|ofl/oldstandardtt/OldStandard-Italic.ttf
OldStandard-Regular.ttf|copy|ofl/oldstandardtt/OldStandard-Regular.ttf
OleoScript-Bold.ttf|copy|ofl/oleoscript/OleoScript-Bold.ttf
OleoScript-Regular.ttf|copy|ofl/oleoscript/OleoScript-Regular.ttf
Outfit.ttf|copy|ofl/outfit/Outfit[wght].ttf
Overpass-var.ttf|copy|ofl/overpass/Overpass[wght].ttf
OverpassMono-var.ttf|copy|ofl/overpassmono/OverpassMono[wght].ttf
PinyonScript-Regular.ttf|copy|ofl/pinyonscript/PinyonScript-Regular.ttf
PlayfairDisplay-Italic[wght].ttf|copy|ofl/playfairdisplay/PlayfairDisplay-Italic[wght].ttf
PlayfairDisplaySC-Black.ttf|copy|ofl/playfairdisplaysc/PlayfairDisplaySC-Black.ttf
PlayfairDisplaySC-Bold.ttf|copy|ofl/playfairdisplaysc/PlayfairDisplaySC-Bold.ttf
PlayfairDisplay[wght].ttf|copy|ofl/playfairdisplay/PlayfairDisplay[wght].ttf
PoiretOne-Regular.ttf|copy|ofl/poiretone/PoiretOne-Regular.ttf
Qw3aZQNVED7rKGKxtqIqX5EUDXx4Vn8sig.woff2|w2|ofl/josefinsans/JosefinSans[wght].ttf
Rajdhani-Light.ttf|copy|ofl/rajdhani/Rajdhani-Light.ttf
Rajdhani-Medium.ttf|copy|ofl/rajdhani/Rajdhani-Medium.ttf
Rajdhani-Regular.ttf|copy|ofl/rajdhani/Rajdhani-Regular.ttf
Rajdhani-SemiBold.ttf|copy|ofl/rajdhani/Rajdhani-SemiBold.ttf
ShareTechMono-Regular.ttf|copy|ofl/sharetechmono/ShareTechMono-Regular.ttf
Shrikhand-Regular.ttf|copy|ofl/shrikhand/Shrikhand-Regular.ttf
Silkscreen-Bold.ttf|copy|ofl/silkscreen/Silkscreen-Bold.ttf
Silkscreen-Regular.ttf|copy|ofl/silkscreen/Silkscreen-Regular.ttf
TitanOne-Regular.ttf|copy|ofl/titanone/TitanOne-Regular.ttf
UncialAntiqua-Regular.ttf|copy|ofl/uncialantiqua/UncialAntiqua-Regular.ttf
UnifrakturMaguntia-Regular.ttf|copy|ofl/unifrakturmaguntia/UnifrakturMaguntia-Book.ttf
VT323-Regular.ttf|copy|ofl/vt323/VT323-Regular.ttf
ZhiMangXing-Regular.ttf|copy|ofl/zhimangxing/ZhiMangXing-Regular.ttf
baloo2.woff2|w2|ofl/baloo2/Baloo2[wght].ttf
bungee.woff2|w2|ofl/bungee/Bungee-Regular.ttf
caveatbrush_CaveatBrush-Regular.ttf|copy|ofl/caveatbrush/CaveatBrush-Regular.ttf
gaegu_Gaegu-Bold.ttf|copy|ofl/gaegu/Gaegu-Bold.ttf
gaegu_Gaegu-Regular.ttf|copy|ofl/gaegu/Gaegu-Regular.ttf
gochihand_GochiHand-Regular.ttf|copy|ofl/gochihand/GochiHand-Regular.ttf
h0.woff2|instw2:wght=500|ofl/cinzel/Cinzel[wght].ttf
h1.woff2|instw2:wght=700|ofl/cinzel/Cinzel[wght].ttf
h2.woff2|instw2:wght=500|ofl/cormorantgaramond/CormorantGaramond-Italic[wght].ttf
h3.woff2|instw2:wght=500|ofl/cormorantgaramond/CormorantGaramond[wght].ttf
h4.woff2|instw2:wght=600|ofl/cormorantgaramond/CormorantGaramond[wght].ttf
patrickhand_PatrickHand-Regular.ttf|copy|ofl/patrickhand/PatrickHand-Regular.ttf
shippori-500.woff2|w2|ofl/shipporimincho/ShipporiMincho-Medium.ttf
shippori-700.woff2|w2|ofl/shipporimincho/ShipporiMincho-Bold.ttf
shippori-kanji.woff2|w2|ofl/shipporimincho/ShipporiMincho-SemiBold.ttf
shortstack_ShortStack-Regular.ttf|copy|ofl/shortstack/ShortStack-Regular.ttf
sniglet_Sniglet-Regular.ttf|copy|ofl/sniglet/Sniglet-Regular.ttf
titanone.woff2|w2|ofl/titanone/TitanOne-Regular.ttf
vt323.woff2|w2|ofl/vt323/VT323-Regular.ttf
yuji-kanji.woff2|w2|ofl/yujisyuku/YujiSyuku-Regular.ttf
SPECEOF

spec_lookup(){ # $1=name -> "op|src" 或空
  awk -F'|' -v n="$1" '$1==n{print $2"|"$3; exit}' "$SPEC"
}

# ---------------------------------------------------------------- 主流程
cd "$LIB" || exit 1
[ -n "$ONLY" ] && echo "（--only：只处理 $ONLY）"
echo "===== 阶段1：扫描引用 ====="
REFS=$(mktemp)
for d in styles/*/demo; do
  wanted "$(basename "$(dirname "$d")")" || continue
  CSS="$d/fonts/fonts.css"
  [ -f "$CSS" ] || continue
  grep -oE "url\([^)]*\)" "$CSS" \
    | sed -E "s/^url\(//; s/\)$//; s/^['\"]//; s/['\"]$//" \
    | sort -u | while read -r f; do
        [ -z "$f" ] && continue
        case "$f" in http*|data:*|//*) continue;; esac
        echo "$d/fonts/$f"
      done
done | sort -u > "$REFS"
TOTAL=$(wc -l < "$REFS")
echo "引用（demo×文件，去重后）: $TOTAL"
echo "唯一文件名: $(sed 's|.*/||' "$REFS" | sort -u | wc -l)"

echo
echo "===== 阶段2：生产并落盘 ====="
while read -r path; do
  [ -z "$path" ] && continue
  name=$(basename "$path")
  if validate "$path" any; then
    echo "  跳过(已存在) $path" | tee -a "$OKLOG"
    continue
  fi
  sp=$(spec_lookup "$name")
  if [ -z "$sp" ]; then
    echo "❌ 无映射规则: $name" | tee -a "$FAILED"
    continue
  fi
  op="${sp%%|*}"; src="${sp#*|}"
  out=$(produce "$name" "$op" "$src")
  if [ -n "$out" ] && [ -f "$out" ]; then
    cp -f "$out" "$path" && chown lemo:lemo "$path" 2>/dev/null
    if validate "$path" any; then
      sz=$(stat -c%s "$path")
      echo "  ✅ $path  ($sz 字节, op=$op)" | tee -a "$OKLOG"
    else
      echo "❌ 落盘后校验失败: $path  (op=$op src=$src)" | tee -a "$FAILED"
      rm -f "$path"
    fi
  else
    echo "❌ 生产失败: $name  (op=$op src=$src)" | tee -a "$FAILED"
  fi
done < "$REFS"

echo
echo "===== 阶段3：统计 ====="
OK=0; MISS=0
while read -r path; do
  if validate "$path" any; then OK=$((OK+1)); else MISS=$((MISS+1)); echo "MISSING $path" >> "$FAILED"; fi
done < "$REFS"
{
  echo "引用总数(demo×文件): $TOTAL"
  echo "已就绪: $OK"
  echo "仍缺失: $MISS"
} | tee "$REPORT"
echo
echo "失败/缺失清单见: $FAILED"
rm -f "$SPEC" "$REFS"

# ============================================================================
# 阶段4/5：阶段1-3 只覆盖 styles/*/demo/fonts/fonts.css 这一种布局。
#          全仓还有两类，一并补齐（依赖 $HELPDIR 下的两个 helper 脚本）
# ============================================================================
PYVENV="$PY"

if [ -z "$ONLY" ]; then
echo
echo "===== 阶段4：Google Fonts 子集包型 fonts.css（4 个 demo，共 817 个引用）====="
else
echo
echo "===== 阶段4：Google Fonts 子集包型 fonts.css（--only 过滤）====="
fi
CSS4=""
for s in watercolor paper-popup game-show halftone-dossier; do
  wanted "$s" && CSS4="$CSS4 styles/$s/demo/fonts.css"
done
if [ -z "$CSS4" ]; then
  echo "  （--only 未命中任何子集包型 demo，跳过）"
elif [ -x "$PYVENV" ] && [ -f "$HELPDIR/fetch-subset-fonts.py" ]; then
  sed 's/\r$//' "$HELPDIR/fetch-subset-fonts.py" > /tmp/fetch-subset-fonts.py
  "$PYVENV" /tmp/fetch-subset-fonts.py "$LIB" $CSS4 2>&1 | grep -vE 'NOT subset|WARNING'
else
  echo "  ⚠ 缺少 $PYVENV 或 fetch-subset-fonts.py，跳过阶段4"
  echo "    （安装：python3 -m venv /opt/fonttools-venv && /opt/fonttools-venv/bin/pip install fonttools brotli）"
fi

echo
echo "===== 阶段5：index.html 里直接引用 fonts/ 的 demo（7 个 demo，共 18 个文件）====="
if [ -f "$HELPDIR/fetch-extra-fonts.sh" ]; then
  sed 's/\r$//' "$HELPDIR/fetch-extra-fonts.sh" > /tmp/fetch-extra-fonts.sh
  LEMO_LIB="$LIB" FONT_CACHE="$CACHE" ONLY_SLUGS="$ONLY" bash /tmp/fetch-extra-fonts.sh
else
  echo "  ⚠ 缺少 fetch-extra-fonts.sh，跳过阶段5"
fi

echo
if [ -z "$ONLY" ]; then
echo "===== 阶段6：全仓引用审计 ====="
if [ -f "$HELPDIR/audit-font-refs.py" ]; then
  sed 's/\r$//' "$HELPDIR/audit-font-refs.py" > /tmp/audit-font-refs.py
  python3 /tmp/audit-font-refs.py "$LIB"
fi
else
echo "===== 阶段6：全仓引用审计（--only 下跳过，避免把未处理的风格报成缺失）====="
fi
