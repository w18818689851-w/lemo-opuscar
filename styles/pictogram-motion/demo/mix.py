#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
编排器音频链的**薄壳**（无命令行参数）。

本 demo 的音频是「另一套架构」：配乐由 `music/music.py` 直出 `music/music.wav`
（母带 −14 LUFS / TP ≤ −1 dBTP，无配音），成片由自带的 `mux.sh` 直混那份 wav，
**从来没有 `mix.wav` 这个概念**。而编排器 `lemo-make.mjs` 的混音步只在
`$D/mix.py` / `$D/sound.py` / `$D/audio/mix.py` 三个名字里找脚本（`lemo-make.mjs:2066-2068`），
一个都没有时报 `STEP_FAIL 该 demo 没有 mix.py / sound.py / audio/mix.py —— 它用的是另一套音频架构`
（`lemo-make.mjs:2290-2297`）⇒ 本风格走不了编排器的音频链。

本壳不重写 `music.py` 的逻辑、也不碰视频，只按本 demo 自己的构建顺序（`DEMO.md`「Build notes」1–2 步）
把既有脚本串起来，再把结果落到编排器契约位置 `demo/mix.wav`：

  1) `node music/export_timeline.cjs`   → `music/timeline.json`
        （`edl.js` → 画面锁定时间轴。★ 编排器**不会**自动跑这一步，而 `music.py` 一 import 就读它
         —— 少了这一步，配乐会按上一次的剪辑表锁拍。）
  2) `<本进程解释器> music/music.py`    → `music/music_bed.wav` / `music/sfx.wav` /
        `music/music.wav`（母带）/ `music/report.txt`
  3) 交付口径的真峰值收口：4× 过采样 + `alimiter`（不加重整增益）→ `demo/mix.wav`

第 3 步为什么必要（**实测数据，不是猜的**）：本 demo 无配音，「混音」就是配乐母带；
但母带是**打击乐极重**的素材（150 BPM 太鼓），波峰因子 PLR = TP − I = 12.99 dB。
`core/render/mux.sh` 的 loudnorm 出口把电平钉在 −14 LUFS（gain = −14 − I，本片恒为 +0.1 dB 上下），
于是编码器入口的真峰值 ≈ 母带 TP；而 **AAC 256k 对这种素材的过冲实测 1.6~2.3 dB**，远超 mux.sh
为编码预留的 0.5 dB 余量（`core/render/mux.sh` 文件头「编码余量」段：全 43 片实测过冲 0.08~1.66 dB）。
实测（2026-10-05，WSL ffmpeg 6.1.1，用**真实** `core/render/mux.sh` 逐档扫描）：

    mix.wav PLR   成片真峰值      成片响度
    12.99（原样） +0.28 dBTP     −14.08 LUFS    ← 超 −1.2 dBTP 交付线
    10.70         −1.27 dBTP     −14.09 LUFS    ← 余量仅 0.07 dB，太薄
     9.22         −2.85 dBTP     −14.09 LUFS    ← 平台区起点，余量 1.65 dB
     8.61         −2.77 dBTP     −14.09 LUFS    ← 再压不再变好

⇒ 取 **−6.5 dBFS** 的 4× 过采样真峰值天花板：这是把成片真峰值推进「安全平台区」的**最小**干预，
响度全程钉在 −14.09 LUFS（在 −14±1 窗内）—— 即 `core/render/mux.sh` 注释里登记为「两条交付线
无法同时满足」的那个 case，靠**降波峰因子**（而不是下调 loudnorm 的 TP 目标，那会掉响度）解开。
母带本身一字未改，仍在 `music/music.wav`；本步只决定交给混流的交付电平。

调用契约（照 `lemo-make.mjs` 写）：
  · 无任何命令行参数（编排器以 `.venv/bin/python "$MIX"` 调用，工作目录是**库根**，不是 demo/）；
  · 所以这里所有路径都按 `__file__` 解析，不依赖 cwd；
  · 跑完必须让 `mix.wav` 出现在 `demo/mix.wav`（编排器取「比本次运行标记更新」的那个）。
失败：打印原因并以非 0 退出（编排器据此打 `STEP_FAIL mix.py`）。
"""
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))          # …/styles/pictogram-motion/demo
MUSIC_DIR = os.path.join(HERE, 'music')
TIMELINE_CJS = os.path.join(MUSIC_DIR, 'export_timeline.cjs')
MUSIC_PY = os.path.join(MUSIC_DIR, 'music.py')
MASTER = os.path.join(MUSIC_DIR, 'music.wav')              # music.py 的母带产物
OUT = os.path.join(HERE, 'mix.wav')                        # 编排器契约位置（优先）

# 交付口径的真峰值天花板（见文件头实测表）：4× 过采样后限幅到 −6.5 dBFS，不做自动重整增益。
TP_CEIL_DBFS = -6.5
LIMIT_AF = ('aresample=192000,alimiter=limit=%.6f:level=disabled:attack=0.1:release=10,'
            'aresample=48000') % (10.0 ** (TP_CEIL_DBFS / 20.0))


def die(msg):
    print('mix.py: ' + msg, file=sys.stderr, flush=True)
    sys.exit(1)


def run(cmd, label):
    """跑一条既有脚本；失败即打印原因并非 0 退出（不吞错）。"""
    print('[mix.py] %s: %s' % (label, ' '.join(cmd)), flush=True)
    try:
        rc = subprocess.run(cmd, cwd=HERE).returncode
    except OSError as e:
        die('无法启动 %s：%s' % (cmd[0], e))
    if rc != 0:
        die('%s 失败（退出码 %s）' % (label, rc))


def loudnorm(path):
    """用 ffmpeg loudnorm 量一份音频的 (响度 LUFS, 真峰值 dBTP) —— 与 core/render/mux.sh 同口径。"""
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af',
                        'loudnorm=I=-14:TP=-1.7:LRA=11:print_format=json', '-f', 'null', '-'],
                       capture_output=True, text=True)
    m = re.search(r'\{[^{}]*\}', r.stderr, re.S)
    if not m:
        die('量不到 %s 的响度（ffmpeg 没吐 JSON）' % path)
    j = json.loads(m.group(0))
    return float(j['input_i']), float(j['input_tp'])


def main():
    if len(sys.argv) > 1:
        # 编排器不带参数调用；多余参数说明调用方搞错了，出声而不是静默忽略。
        print('mix.py: 不接受命令行参数（收到 %r）' % (sys.argv[1:],), file=sys.stderr, flush=True)
        sys.exit(2)

    # node 走 PATH（编排器已 export PATH=/usr/local/bin:$PATH）；找不到就报清楚。
    node = shutil.which('node')
    if not node:
        die('找不到 node（export_timeline.cjs 要用它）')
    # ffmpeg 是 music.py 自带的依赖（它用它写 report.txt），第 3 步也用它。
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        die('找不到 ffmpeg（music.py 的 report 与第 3 步的真峰值收口都要用它）')

    run([node, TIMELINE_CJS], '1/3 导出画面锁定时间轴')
    # ★ 用 sys.executable —— 编排器以 .venv/bin/python 调本壳，music.py 需要同一个解释器
    #   （numpy / scipy 只在那个 venv 里）。
    run([sys.executable, MUSIC_PY], '2/3 合成配乐母带')

    if not os.path.isfile(MASTER) or os.path.getsize(MASTER) == 0:
        die('music.py 跑完但没有产出 %s' % MASTER)

    mi, mt = loudnorm(MASTER)
    print('[mix.py] 母带 %s：I=%.2f LUFS  TP=%.2f dBTP  PLR=%.2f dB' % (MASTER, mi, mt, mt - mi), flush=True)

    run([ffmpeg, '-y', '-loglevel', 'error', '-i', MASTER, '-af', LIMIT_AF,
         '-c:a', 'pcm_s24le', OUT], '3/3 交付口径真峰值收口（4× 过采样限幅 %.1f dBFS）' % TP_CEIL_DBFS)

    if not os.path.isfile(OUT) or os.path.getsize(OUT) == 0:
        die('第 3 步没有产出 %s' % OUT)
    oi, ot = loudnorm(OUT)
    print('[mix.py] 混音 %s（%d 字节）：I=%.2f LUFS  TP=%.2f dBTP  PLR=%.2f dB'
          % (OUT, os.path.getsize(OUT), oi, ot, ot - oi), flush=True)


if __name__ == '__main__':
    main()
