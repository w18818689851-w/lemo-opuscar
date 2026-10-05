#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""game-show 人声重制：用项目自带 Kokoro 离线 TTS 替代 macOS `say`。

背景：原 make_voices.sh 依赖 macOS 的 say 声线（Samantha/Fred/Zarvox…），本机没有 macOS，
      voices/*.wav 一个都生不出来，music.py 直接 FileNotFoundError。
      本脚本用 core/tts/tts.py（Kokoro，离线）生成同样的 40 条呼喊，再复刻 make_voices.sh 的
      「变调不变速」信号链，产物落在 voices/<名字>.wav（44.1 kHz 单声道），供 music.py 读取。

输入：voices/lines.txt + lines2.txt + lines3.txt
      每行：名字|声线(macOS)|语速(say -r)|变调倍数|台词
输出：<输出目录>/<名字>.wav   默认 voices/（与 make_voices.sh 的默认 out/voices_regen 不同，本脚本直出正位）

信号链（唯一与原脚本的差异：Kokoro 出 24 kHz，原 say 出 22050 Hz）：
      ffmpeg -af "asetrate=24000*$PITCH,aresample=44100,atempo=1/$PITCH" -ac 1 -ar 44100
      Zarvox（机器人声线）额外叠一层轻度幅度调制，还原原 Zarvox 的机器人质感。

用法：
      .venv/bin/python make_voices_kokoro.py [输出目录]
      加 --no-mod 可关闭 Zarvox 的调制（仅 am_onyx 干声）。

本脚本是新增文件；make_voices.sh 保持原样未改。
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))   # /home/lemo/lemo-opuscar
PY = os.path.join(REPO, '.venv', 'bin', 'python')
TTS = os.path.join(REPO, 'core', 'tts', 'tts.py')

# macOS 声线 → Kokoro 声线（Kokoro 无机器人声线，Zarvox 用 am_onyx + 调制近似）
VOICE_MAP = {
    'Samantha': 'af_heart',    # 标准女播报
    'Kathy':    'af_bella',    # 另一女声
    'Junior':   'af_sky',      # 童声
    'Fred':     'am_michael',  # 沉稳男播报
    'Ralph':    'am_fenrir',   # 粗一些的男声
    'Superstar':'am_puck',     # 活泼男声
    'Zarvox':   'am_onyx',     # 机器人/AI 播报（本风格核心特质）
}
# 需要加「机器人」调制的 macOS 声线
ROBOT = {'Zarvox'}
# 幅度调制：55 Hz，深度 0.35（(1-0.35)+0.35*sin）——克制，保可懂度
MOD_RATE, MOD_DEPTH = 55.0, 0.35
MOD_FILTER = "aeval=val(0)*(%.2f+%.2f*sin(2*PI*%.0f*t))" % (1 - MOD_DEPTH, MOD_DEPTH, MOD_RATE)


def parse_lines():
    rows = []
    for fn in ('lines.txt', 'lines2.txt', 'lines3.txt'):
        with open(os.path.join(HERE, 'voices', fn), encoding='utf-8') as f:
            for raw in f:
                line = raw.rstrip('\n')
                if not line.strip():
                    continue
                name, voice, rate, pitch, text = line.split('|', 4)
                rows.append({'name': name, 'mac': voice, 'rate': int(rate),
                             'pitch': float(pitch), 'text': text})
    return rows


def kokoro_speed(rate):
    """say -r 语速 → Kokoro speed：以 200 wpm 为基准线性映射，夹在 [0.80, 1.15]。"""
    return round(min(1.15, max(0.80, rate / 200.0)), 2)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    mod_on = '--no-mod' not in sys.argv
    out_dir = os.path.abspath(args[0]) if args else os.path.join(HERE, 'voices')
    os.makedirs(out_dir, exist_ok=True)

    rows = parse_lines()
    print('读到 %d 条呼喊' % len(rows))

    lines = []
    for r in rows:
        k = VOICE_MAP.get(r['mac'])
        if not k:
            sys.exit('未知 macOS 声线 %r（%s）' % (r['mac'], r['name']))
        lines.append({'id': r['name'], 'text': r['text'], 'voice': k,
                      'speed': kokoro_speed(r['rate']), 'lang': 'en-us'})

    raw_dir = os.path.join(HERE, 'out', 'voices_kokoro_raw')
    shutil.rmtree(raw_dir, ignore_errors=True)
    os.makedirs(raw_dir, exist_ok=True)
    lines_json = os.path.join(raw_dir, 'lines.json')
    with open(lines_json, 'w', encoding='utf-8') as f:
        json.dump(lines, f, ensure_ascii=False, indent=1)

    # 1) Kokoro 合成（24 kHz）
    cmd = [PY, TTS, lines_json, raw_dir]
    print('+', ' '.join(cmd))
    rc = subprocess.call(cmd, cwd=REPO)
    if rc != 0:
        sys.exit('tts.py 失败，退出码 %d' % rc)

    # 2) 变调不变速 → 44.1 kHz 单声道，直出 voices/
    missing = []
    for r in rows:
        src = os.path.join(raw_dir, r['name'] + '.wav')
        dst = os.path.join(out_dir, r['name'] + '.wav')
        if not os.path.exists(src):
            missing.append(r['name'])
            continue
        af = ('asetrate=%d*%s,aresample=44100,atempo=%s'
              % (24000, r['pitch'], 1.0 / r['pitch']))
        if mod_on and r['mac'] in ROBOT:
            af += ',' + MOD_FILTER
        subprocess.check_call(['ffmpeg', '-y', '-loglevel', 'error', '-i', src,
                               '-af', af, '-ac', '1', '-ar', '44100', dst])
        print('  %-9s %-10s -> %-9s pitch=%-5s speed=%.2f%s'
              % (r['name'], r['mac'], VOICE_MAP[r['mac']], r['pitch'],
                 kokoro_speed(r['rate']),
                 ' [mod]' if (mod_on and r['mac'] in ROBOT) else ''))

    if missing:
        sys.exit('以下 id 未生成：%s' % ', '.join(missing))

    got = sorted(x for x in os.listdir(out_dir) if x.endswith('.wav'))
    print('完成：%s 下 %d 个 wav' % (out_dir, len(got)))
    print('Zarvox 调制：%s' % (('开 ' + MOD_FILTER) if mod_on else '关'))


if __name__ == '__main__':
    main()
