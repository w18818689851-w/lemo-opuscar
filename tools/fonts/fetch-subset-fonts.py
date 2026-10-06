#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
为「Google Fonts 子集包」型 fonts.css 补齐字体，且不修改任何已跟踪文件。

原理：本地 fonts.css 每个 @font-face 块都带 unicode-range。
      → 按 (family, style) 从 google/fonts 仓库取**可变字体原文件**
      → 先裁到该 face 全部块的码位并集（中间产物，快）
      → 再按每个块自己的码位裁一次，转 woff2，存成该块引用的文件名
      这样文件语义等价于 Google 的 subset，且完全离线可复现。
      不实例化（保留可变轴），保证同一文件被多个 weight 共用时也正确。

用法: python3 tools/fonts/fetch-subset-fonts.py <repo根> <css路径> [<css路径> ...]
      （被 tools/fetch-fonts.sh 的阶段4 调用；缓存目录可用 FONT_CACHE / FONT_SUB_TMP 覆盖）
"""
import os, re, sys, json, subprocess, hashlib

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/130.0 Safari/537.36')
MIRRORS = ['https://cdn.jsdelivr.net/gh/google/fonts@main',
           'https://raw.githubusercontent.com/google/fonts/main']
CACHE = os.environ.get('FONT_CACHE', '/opt/fontsrc-cache')
TMP = os.environ.get('FONT_SUB_TMP', '/opt/fontsub-tmp')
os.makedirs(CACHE, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

# family -> (normal 源, italic 源)；None 表示无
FAMILY_SRC = {
    'ZCOOL KuaiLe':      ('ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf', None),
    'Noto Sans SC':      ('ofl/notosanssc/NotoSansSC[wght].ttf', None),
    'Noto Serif SC':     ('ofl/notoserifsc/NotoSerifSC[wght].ttf', None),
    'Bagel Fat One':     ('ofl/bagelfatone/BagelFatOne-Regular.ttf', None),
    'JetBrains Mono':    ('ofl/jetbrainsmono/JetBrainsMono[wght].ttf',
                          'ofl/jetbrainsmono/JetBrainsMono-Italic[wght].ttf'),
    'Fredoka':           ('ofl/fredoka/Fredoka[wdth,wght].ttf', None),
    'IM Fell English':   ('ofl/imfellenglish/IMFeENrm28P.ttf',
                          'ofl/imfellenglish/IMFeENit28P.ttf'),
    'IM Fell English SC':('ofl/imfellenglishsc/IMFeENsc28P.ttf', None),
    'Lilita One':        ('ofl/lilitaone/LilitaOne-Regular.ttf', None),
    'Caveat':            ('ofl/caveat/Caveat[wght].ttf', None),
    'Cormorant Garamond':('ofl/cormorantgaramond/CormorantGaramond[wght].ttf',
                          'ofl/cormorantgaramond/CormorantGaramond-Italic[wght].ttf'),
    'IBM Plex Mono':     ('ofl/ibmplexmono/IBMPlexMono-Regular.ttf', None),
    'Inter Tight':       ('ofl/intertight/InterTight[wght].ttf', None),
    'Inter':             ('ofl/inter/Inter[opsz,wght].ttf', None),
    'Ma Shan Zheng':     ('ofl/mashanzheng/MaShanZheng-Regular.ttf', None),
    'Zhi Mang Xing':     ('ofl/zhimangxing/ZhiMangXing-Regular.ttf', None),
    'Noto Sans JP':      ('ofl/notosansjp/NotoSansJP[wght].ttf', None),
    'DM Mono':           ('ofl/dmmono/DMMono-Medium.ttf', None),
    'Long Cang':         ('ofl/longcang/LongCang-Regular.ttf', None),
}
MAGIC = {b'\x00\x01\x00\x00', b'true', b'OTTO', b'ttcf', b'wOF2', b'wOFF'}


def log(*a):
    print(*a, flush=True)


def curl(url, out=None, timeout=180):
    cmd = ['curl', '-fsSL', '--retry', '2', '--retry-delay', '1',
           '--max-time', str(timeout), '-H', 'User-Agent: ' + UA]
    if out:
        cmd += ['-o', out]
    cmd.append(url)
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        return None
    return p.stdout if not out else True


def valid(path, min_size=300):
    """子集字体合法时可能很小（Google 自己发的 latin-ext 子集就 1.3KB），
    故子集产物用 min_size=300；简报里对 119 个完整字体仍按 >2KB 严格校验。"""
    try:
        if os.path.getsize(path) <= min_size:
            return False
        with open(path, 'rb') as f:
            return f.read(4) in MAGIC
    except OSError:
        return False


def valid_font(path, min_size=300):
    """比 valid() 更严：还要能被 fontTools 打开且 cmap 非空。
    否则浏览器 OTS 会报 'cmap: No subtables in cmap!' 并判定字体无效。"""
    if not valid(path, min_size):
        return False
    try:
        from fontTools.ttLib import TTFont
        f = TTFont(path, lazy=True)
        ok = 'cmap' in f and bool(f['cmap'].tables) and \
             any(t.cmap for t in f['cmap'].tables)
        f.close()
        return ok
    except Exception:
        return False


def cmap_codepoints(path):
    from fontTools.ttLib import TTFont
    f = TTFont(path, lazy=True)
    cps = set()
    if 'cmap' in f:
        for t in f['cmap'].tables:
            cps |= set(t.cmap.keys())
    f.close()
    return cps


def urlenc(p):
    return p.replace('[', '%5B').replace(']', '%5D').replace(',', '%2C').replace(' ', '%20')


def repo_file(rel):
    dest = os.path.join(CACHE, re.sub(r'[/,\[\]]', '_', rel))
    if valid(dest):
        return dest
    for m in MIRRORS:
        if curl('%s/%s' % (m, urlenc(rel)), out=dest) and valid(dest):
            return dest
        if os.path.exists(dest):
            os.remove(dest)
    return None


def parse_css(text):
    out = []
    for m in re.finditer(r'@font-face\s*\{(.*?)\}', text, re.S):
        b = m.group(1)
        d = {}
        for p in re.finditer(r'([a-z-]+)\s*:\s*([^;]+)', b, re.S):
            d[p.group(1).strip().lower()] = p.group(2).strip()
        u = re.search(r'url\(\s*[\'"]?([^\'")]+)', b)
        if not u:
            continue
        d['_url'] = u.group(1).strip()
        d['_family'] = d.get('font-family', '').strip().strip('\'"')
        d['_style'] = d.get('font-style', 'normal').strip()
        d['_weight'] = d.get('font-weight', '400').strip()
        d['_urange'] = d.get('unicode-range', '').strip()
        out.append(d)
    return out


def expand_urange(s):
    """U+2014, U+201c-201d -> [0x2014, 0x201c, 0x201d]"""
    cps = set()
    for part in s.split(','):
        part = part.strip().upper().replace('U+', '')
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-')[:2]
            try:
                a, b = int(a, 16), int(b, 16)
            except ValueError:
                continue
            if b - a > 20000:      # 防止异常范围炸内存
                b = a + 20000
            cps.update(range(a, b + 1))
        else:
            try:
                cps.add(int(part, 16))
            except ValueError:
                pass
    return cps


def make_subsetter():
    from fontTools import subset
    o = subset.Options()
    o.flavor = None
    o.desubroutinize = False
    o.notdef_outline = True
    o.recalc_bounds = False
    o.recalc_timestamp = False
    o.name_IDs = ['*']
    o.name_legacy = True
    o.name_languages = ['*']
    o.layout_features = ['*']
    o.drop_tables = []
    o.hinting = True
    o.legacy_kern = True
    return o


def subset_to(src, dst, codepoints, flavor=None):
    from fontTools import subset
    o = make_subsetter()
    o.flavor = flavor
    font = subset.load_font(src, o)
    s = subset.Subsetter(options=o)
    s.populate(unicodes=sorted(codepoints))
    s.subset(font)
    subset.save_font(font, dst, o)
    font.close()


def main():
    if len(sys.argv) < 3:
        sys.exit('用法: python3 fetch-subset-fonts.py <repo根> <css路径> [<css路径> ...]')
    root = sys.argv[1]
    css_list = sys.argv[2:]
    summary = []
    for cssrel in css_list:
        csspath = os.path.join(root, cssrel)
        if not os.path.isfile(csspath):
            log('!! 找不到', cssrel)
            continue
        cssdir = os.path.dirname(csspath)
        blocks = parse_css(open(csspath, encoding='utf-8', errors='replace').read())
        # 按 (family, style) 归组
        faces = {}
        for b in blocks:
            faces.setdefault((b['_family'], b['_style']), []).append(b)
        reduced = {}
        for (fam, style), bs in faces.items():
            srcs = FAMILY_SRC.get(fam)
            if not srcs:
                log('   ⚠ 无源映射:', fam)
                continue
            rel = srcs[1] if 'italic' in style else srcs[0]
            if not rel:
                rel = srcs[0]
            f = repo_file(rel)
            if not f:
                log('   ⚠ 源下载失败:', fam, rel)
                continue
            union = set()
            for b in bs:
                union |= expand_urange(b['_urange'])
            key = '%s|%s' % (fam, style)
            inter = os.path.join(TMP, hashlib.md5(key.encode()).hexdigest()[:10] + '.ttf')
            if not os.path.exists(inter):
                try:
                    subset_to(f, inter, union)
                except Exception as e:
                    log('   ⚠ 并集裁剪失败 %s: %s' % (key, e))
                    continue
            reduced[(fam, style)] = inter
        # 每个 face 实际拥有的码位（用来挑「锚点」，保证子集 cmap 非空）
        anchors = {}
        for k, inter in reduced.items():
            try:
                cps = cmap_codepoints(inter)
            except Exception:
                cps = set()
            a = sorted(c for c in (0x20, 0xA0, 0x41, 0x61, 0x30) if c in cps)
            if not a and cps:
                a = [min(cps)]
            anchors[k] = a
        ok = skip = fail = 0
        fails = []
        for b in blocks:
            tgt = os.path.join(cssdir, b['_url'])
            if valid_font(tgt):
                skip += 1
                continue
            if os.path.exists(tgt):
                os.remove(tgt)          # 可能是空 cmap 的坏产物
            inter = reduced.get((b['_family'], b['_style']))
            if not inter:
                fail += 1
                fails.append('%s (无中间字体: %s/%s)' % (b['_url'], b['_family'], b['_style']))
                continue
            os.makedirs(os.path.dirname(tgt), exist_ok=True)
            cps = expand_urange(b['_urange'])
            try:
                subset_to(inter, tgt, cps, flavor='woff2')
            except Exception as e:
                fails.append('%s (裁剪失败 %s)' % (b['_url'], e))
                fail += 1
                continue
            if not valid_font(tgt):
                # 该块码位在字体里一个都不存在 → 补锚点重做，避免空 cmap 被 OTS 拒
                try:
                    subset_to(inter, tgt, set(anchors.get((b['_family'], b['_style'])) or [0x20]),
                              flavor='woff2')
                except Exception as e:
                    fails.append('%s (锚点重做失败 %s)' % (b['_url'], e))
            if valid_font(tgt):
                ok += 1
            else:
                if os.path.exists(tgt):
                    os.remove(tgt)
                fail += 1
                fails.append('%s (校验失败)' % b['_url'])
        log('%-46s 块=%-4d 已存在=%-4d 新生成=%-4d 失败=%d'
            % (cssrel, len(blocks), skip, ok, fail))
        for x in fails[:8]:
            log('    ❌', x)
        summary.append({'css': cssrel, 'blocks': len(blocks), 'skip': skip,
                        'ok': ok, 'fail': fail, 'fails': fails[:20]})
    log(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()
