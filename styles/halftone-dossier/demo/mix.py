#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""halftone-dossier 混音壳 —— 让编排器能把本风格的音频链跑起来（2026-10-05 新增）。

背景：本风格的音频链**只有一步** —— demo/music.py 一次性合成「配乐 + 音效 + 母带」
（纯 numpy/scipy、`default_rng(7)` 确定性、**无配音、无外部素材**），产物默认是
demo/music.wav。原来没有独立的混音步骤，demo/mix.wav 就是 `python music.py mix.wav`
的产物。而编排器 lemo-make.mjs 的混音步只认三个候选文件名
（demo/mix.py → demo/sound.py → demo/audio/mix.py，见 lemo-make.mjs 的混音脚本候选），
一个都找不到就报 `STEP_FAIL 该 demo 没有 mix.py / sound.py / audio/mix.py` 并 exit 1
（见 lemo-make.mjs 的混音步）—— 本风格因此**根本走不了「主题出片」通路**（只能 --skip-audio）。
★ 这是「形态不匹配」而不是「没有音频链」：音频链是完整真实的，只是没落在那三个文件名上。

本壳做的事（**薄壳，不重写任何配乐逻辑**）：
  1) 用**同一个解释器**（sys.executable，编排器用 .venv/bin/python 调本文件）把既有的
     demo/music.py 按原样跑一遍，把它的**输出路径参数**指向契约要求的 demo/mix.wav
     （music.py 支持 `python music.py [输出.wav]`，见其第 6 行）；
  2) 确认 demo/mix.wav 真的被写出且非空，否则**非 0 退出并说明原因**（绝不静默产出半成品）。

契约（照编排器实际调用来写）：
  · **不接受任何命令行参数**（编排器是 `.venv/bin/python "$D/mix.py"`，不带参数调用）；
  · 所有路径都用 `__file__` 的绝对目录推导 —— 编排器的工作目录是**库根**（`cd "$LIB"`，
    见 lemo-make.mjs 音频脚本开头的 cd "$LIB"），不是 demo/，所以不能依赖 cwd；
  · 产物落点必须是 demo/mix.wav（编排器的首选落点，见 lemo-make.mjs 的 mix.wav 落点探测）；
  · 只管音频，**不碰任何视频**；
  · 幂等：music.py 是 seed 7 确定性的，重复跑逐字节一致（实测同一份 md5）。
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
