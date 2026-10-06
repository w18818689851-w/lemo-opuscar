#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全仓字体引用彻底清点：解析 css/html/js/mjs 中所有指向字体文件的引用，逐个判断是否存在。

用法: python3 tools/fonts/audit-font-refs.py [仓库根]
      （被 tools/fetch-fonts.sh 的阶段6 调用；只读，不改任何文件）
"""
import os, re, sys, json

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.getcwd()
EXTS = ('.css', '.html', '.htm', '.js', '.mjs', '.cjs', '.json')
PAT = re.compile(r"""['"`(]?\s*(?:url\(\s*['"]?)?((?:\.{0,2}/|/)?[A-Za-z0-9_./\[\]%\-@]*fonts?/[^'"`)\s;,]+?\.(?:ttf|otf|woff2?|TTF|OTF|WOFF2?))""")
SKIP_DIRS = {'node_modules', '.git', '.venv', '__pycache__', 'out', '_site', '.release', 'films'}

found = {}   # 绝对路径 -> {'refs': set(引用者), 'raw': set(原始写法)}
for base in ('styles', 'core', 'plugin', 'tools'):
    b = os.path.join(ROOT, base)
    if not os.path.isdir(b):
        continue
    for dp, dns, fns in os.walk(b):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            if not fn.lower().endswith(EXTS):
                continue
            fp = os.path.join(dp, fn)
            try:
                txt = open(fp, encoding='utf-8', errors='replace').read()
            except OSError:
                continue
            for m in PAT.finditer(txt):
                raw = m.group(1)
                if raw.startswith('http'):
                    continue
                if raw.startswith('/'):
                    ap = os.path.normpath(os.path.join(ROOT, raw.lstrip('/')))
                else:
                    ap = os.path.normpath(os.path.join(dp, raw))
                e = found.setdefault(ap, {'refs': set(), 'raw': set()})
                e['refs'].add(os.path.relpath(fp, ROOT).replace('\\', '/'))
                e['raw'].add(raw)

have = {k: v for k, v in found.items() if os.path.isfile(k)}
miss = {k: v for k, v in found.items() if not os.path.isfile(k)}
print('仓库根: %s' % ROOT)
print('引用到的字体路径（去重）: %d' % len(found))
print('  存在: %d' % len(have))
print('  缺失: %d' % len(miss))
print()
# 按 demo 归类
def key(p):
    r = os.path.relpath(p, ROOT).replace('\\', '/')
    parts = r.split('/')
    return '/'.join(parts[:3]) if len(parts) > 3 else '/'.join(parts[:2])
from collections import Counter
c = Counter(key(p) for p in miss)
print('=== 缺失按 demo 归类 ===')
for k, v in c.most_common():
    print('  %-42s %d' % (k, v))
print()
print('=== 缺失明细（demo 内 <=20 个的全列，多的只列前 20）===')
for k in sorted(set(key(p) for p in miss)):
    ps = sorted(p for p in miss if key(p) == k)
    print('--- %s (%d) ---' % (k, len(ps)))
    for p in ps[:20]:
        raw = sorted(found[p]['raw'])[0]
        refs = sorted(found[p]['refs'])[:3]
        print('    %s   <- %s   [%s]' % (os.path.basename(p), raw, ','.join(refs)))
    if len(ps) > 20:
        print('    ... 其余 %d 个' % (len(ps) - 20))
json.dump({k: {'raw': sorted(v['raw']), 'refs': sorted(v['refs'])}
           for k, v in miss.items()},
          open('/tmp/font_missing_all.json', 'w'), ensure_ascii=False, indent=1)
