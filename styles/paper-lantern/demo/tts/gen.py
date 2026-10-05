"""编排器「demo 自带 TTS」入口：把本 demo 的配音交给它自己的 Index-TTS 链（tts_local.py）。

为什么需要这个文件（2026-10-04）：
  编排器（lemo-tools/lemo-make.mjs）的配音步有**两条互斥的路**：
    ① 若 demo 根下有 **$D/lines.json** → 跑 core/tts/tts.py（Kokoro）；
    ② 否则若 demo 自带 **$D/tts/gen.py** → 跑它（本文件就是这一条）。
  本 demo 的配音是 **Index-TTS**（参考音名 voice_09 这种，Kokoro 不认识）。而 tts_local.py 会把
  一份 lines.json 写进 demo 根 ⇒ 编排器误判成第 ① 条 ⇒ Kokoro 报 "unknown voice 'voice_09'"
  ⇒ 音频阶段整条失败（只能靠 --skip-audio 复用旧 mix.wav 出片，配音链是断的）。
  修法：demo 根**不再放 lines.json**（tts_local.py 改写到 out/），配音交给本文件 —— 由它调用
  demo 自己的 tts_local.py，走 Index-TTS，产物仍落在本 demo 约定的 vo/。

为什么带 --target：
  编排器在配音**之前**就已经用**已有的** vo/dur.json 排好了 out/timeline.json（render/cues.mjs）
  与字幕/事件时间窗，而 mix.py 读的正是这份 timeline.json 来逐句摆放配音。所以新合成的逐句时长
  必须与那份已有 dur.json 一致，否则配音会与画面/字幕错位。
  ★ 注意：编排器的「配音前置」回传步骤只回传 voices/*.json，**不管本 demo 的 vo/**；而渲染页与
    cues.mjs 读的是 **Windows 侧**的 vo/dur.json ⇒ 配音阶段就算改了 WSL 侧的 vo/dur.json，
    Windows 那份也不会跟着变。所以**两种调用方式都必须带 --target**（把时长钉在已有 dur.json 上），
    否则画面/字幕窗按旧时长、配音按新时长，二者错位。
  tts_local.py 的 --target 正是为此而设（Index-TTS 原生改时长 + 残余用相位声码器微调到精确值）。
  若 vo/dur.json 不存在（首次运行）则不带 --target，按 script.json 的自然时长合成。

用法（由编排器调用；也可手动跑，cwd 任意）：
  .venv/bin/python styles/paper-lantern/demo/tts/gen.py
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))    # demo/tts/
DEMO = os.path.dirname(HERE)                         # demo/
REPO = os.path.dirname(os.path.dirname(DEMO))        # 仓库根（供 cwd 用）
LOCAL = os.path.join(DEMO, 'tts_local.py')           # 本 demo 的 Index-TTS 链
TARGET = os.path.join(DEMO, 'vo', 'dur.json')        # 已排好的逐句时长（有就对齐）

cmd = [sys.executable, LOCAL]
if os.path.isfile(TARGET):
    cmd += ['--target', TARGET]
    print('tts/gen.py: 对齐已有时间轴 %s' % TARGET, flush=True)
sys.exit(subprocess.run(cmd, cwd=REPO).returncode)
