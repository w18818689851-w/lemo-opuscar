#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""game-show 混音壳 —— 让编排器能把本风格的音频链跑起来（2026-10-05 新增）。

背景：本风格的音频链**只有一步** —— demo/music.py 读 demo/events.json（474 个画面事件）
+ demo/voices/*.wav（40 条呼喊），一次性做完「配乐 + 事件音效 + 呼喊 + 人声闪避混音 +
母带」，产物默认是 demo/music.wav（44.1 kHz；`default_rng(7)` 确定性）。原来没有独立的
混音步骤：`finish.sh` 只是拿 music.wav 去做两遍 loudnorm 再和视频直混成片。
而编排器 lemo-make.mjs 的混音步只认三个候选文件名
（demo/mix.py → demo/sound.py → demo/audio/mix.py，见 lemo-make.mjs:2066-2068），
一个都找不到就报 `STEP_FAIL 该 demo 没有 mix.py / sound.py / audio/mix.py` 并 exit 1
（lemo-make.mjs:2290-2297）—— 本风格因此**根本走不了「主题出片」通路**（只能 --skip-audio）。
★ 这是「形态不匹配」而不是「没有音频链」：混音职责本来就合并在 music.py 里。

本壳做的事（**薄壳，不重写任何配乐/混音逻辑**）：
  1) 用**同一个解释器**（sys.executable，编排器用 .venv/bin/python 调本文件）把既有的
     demo/music.py 按原样跑一遍，把它的**输出路径参数**指向契约要求的 demo/mix.wav
     （music.py 支持 `python music.py [输出.wav]`，见其第 4 行；它自己会 chdir 到 demo/）；
  2) 确认 demo/mix.wav 真的被写出且非空，否则**非 0 退出并说明原因**（绝不静默产出半成品）。

前置条件（都是仓库里已就位、编排器不负责重生成的）：
  · demo/events.json（画面事件表，474 条）；
  · demo/voices/*.wav 40 条呼喊（本机无 macOS `say`，已由 demo/make_voices_kokoro.py 用
    离线 Kokoro 重建，见该文件与 CREDITS）。
缺任一个时 music.py 会自己报错，本壳把它的非 0 退出码原样放大成失败。

契约（照编排器实际调用来写）：
  · **不接受任何命令行参数**（编排器是 `.venv/bin/python "$D/mix.py"`，不带参数调用）；
  · 所有路径都用 `__file__` 的绝对目录推导 —— 编排器的工作目录是**库根**（`cd "$LIB"`，
    见 lemo-make.mjs:1972），不是 demo/，所以不能依赖 cwd；
  · 产物落点必须是 demo/mix.wav（编排器的首选落点，lemo-make.mjs:2307）；
  · 只管音频，**不碰任何视频**；
  · 幂等：music.py 是 seed 7 确定性的，重复跑逐字节一致。
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MUSIC = os.path.join(HERE, 'music.py')
OUT = os.path.join(HERE, 'mix.wav')


def main():
    if not os.path.isfile(MUSIC):
        sys.exit('mix.py: 配乐脚本不存在：%s（本风格的音频链靠它一步产出）' % MUSIC)

    print('[mix] %s -> %s' % (os.path.basename(MUSIC), os.path.basename(OUT)))
    rc = subprocess.call([sys.executable, MUSIC, OUT], cwd=HERE)
    if rc != 0:
        sys.exit('mix.py: %s 失败（退出码 %d），没有产出 %s' % (os.path.basename(MUSIC), rc, OUT))

    if not os.path.isfile(OUT) or os.path.getsize(OUT) <= 44:
        sys.exit('mix.py: %s 退出码 0，但没有写出有效的 %s' % (os.path.basename(MUSIC), OUT))

    print('mix.py: ok %.2f MB -> %s' % (os.path.getsize(OUT) / 1048576.0, OUT))


if __name__ == '__main__':
    main()
