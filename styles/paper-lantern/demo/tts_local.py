"""本地中文配音（Index-TTS 离线）—— 取代 demo/tts.py 的云端 edge-tts。

背景：原 demo 用 edge-tts（云端 TTS），与本库「音频一律本地」的规则冲突，因此成片一度静音。
本脚本走用户本机部署的 Index-TTS 2.5 便携版（core/tts/tts_indextts.py），接口与 core/tts/tts.py 一致。

流程：
  1. 读 script.json，生成 lines.json（写到 out/，**不是 demo 根** —— 否则编排器会误判成
     core/tts/tts.py 的 Kokoro 链并报 unknown voice；见 main() 里 lp 处的说明）：
       text  = 行里的 say（多音字同音字）优先，否则 text（真字留给字幕）
       voice = VOICE（Index-TTS 参考音名/别名，见 core/tts/tts_indextts.py --list-voices）
       speed = 1 + rate/100（script.json 的 rate 覆盖，缺省用 DEFAULT_RATE=+10%，与 tts.py 的 RATE 一致）
       lang  = "cmn"
  2. 调 core/tts/tts_indextts.py 合成到 vo/<id>.wav（22050 Hz 单声道）+ vo/dur.json
  3. 把 vo/<id>.wav 统一重采样成 48 kHz 单声道（DEMO.md 约定的产物格式；时长不变，dur.json 仍有效）

★ --target <dur.json>：对齐已有时间轴（复用已渲染画面时用）。
  画面里的镜头边界/字幕窗口是按旧 vo/dur.json 的时间轴切好的（src/main.js：at[i+1] = at[i] + dur[i] + GAP[i]）。
  换了 TTS 引擎后逐句时长会变，时间轴就漂了。给一个目标 dur.json 后：
    ① 先按 script.json 的 speed 合成一遍，量出每句实际时长 M；
    ② 按 speed *= M/T 校正后再合成一遍（Index-TTS 原生改时长、不变调，比事后变速自然）；
    ③ 残余误差（通常 <3%）用 librosa 相位声码器微调到精确 T，保证时间轴逐句对齐。
  这样 out/timeline.json 与旧版逐句一致，已渲染画面可直接复用。

★ 路径：Index-TTS 的推理内层是 **Windows python**，只认 Windows 路径。外层跑在 WSL 时，
  tts_indextts.py 的 win_path() 只能把 `/mnt/<盘>/...` 转成 `<盘>:/...`。所以 lines.json 与
  out_dir 必须落在 /mnt/<盘>/ 下 —— 本仓库在 WSL 的 ext4（/home/lemo/...）上，因此这里先用一个
  /mnt/d 暂存目录合成，再把 wav 拷回本 demo 的 vo/ 并重采样。

用法（仓库根目录，WSL）：
  .venv/bin/python styles/paper-lantern/demo/tts_local.py [--voice voice_09] [--target old_dur.json]
"""
import json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))             # demo/
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))  # 仓库根
VOICE = 'voice_09'        # 官方参考音：女声（中位基频 218 Hz），8.48 s，干净；克隆后 ~267 Hz
DEFAULT_RATE = 10.0       # 与 demo/tts.py 的 RATE='+10%' 对齐
OUT_SR = 48000
# 外层在 WSL 时的 Windows 暂存目录（Index-TTS 内层要 Windows 路径，见文件头说明）。
# ★ 必须是仓库外、且位于 /mnt/<盘>/ 下的临时目录 —— 不要指向 D:/lemo-films/（那是成片目录，
#   不该被中间产物污染）。可用环境变量 PL_TTS_STAGE 覆盖。
STAGE = os.environ.get('PL_TTS_STAGE', '/mnt/d/tmp/pl_tts_stage')


def _win_ok(p):
    return p.startswith('/mnt/') or bool(re.match(r'^[A-Za-z]:[\\/]', p))


def _synth(entries, voice, stage_lines, stage_out):
    """写一份临时 lines.json 并跑一次 Index-TTS（一次模型加载，批量合成 entries）。"""
    json.dump(entries, open(stage_lines, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    rc = subprocess.run([sys.executable, os.path.join(REPO, 'core', 'tts', 'tts_indextts.py'),
                         stage_lines, stage_out], cwd=REPO).returncode
    if rc != 0:
        sys.exit(rc)
    import soundfile as sf
    return {e['id']: sf.info(os.path.join(stage_out, e['id'] + '.wav')).duration for e in entries}


def main():
    argv = sys.argv[1:]
    voice = VOICE
    target = None
    if '--voice' in argv:
        voice = argv[argv.index('--voice') + 1]
    if '--target' in argv:
        target = json.load(open(argv[argv.index('--target') + 1], encoding='utf-8'))

    lines = json.load(open(os.path.join(HERE, 'script.json'), encoding='utf-8'))
    entries, speeds0 = [], {}
    for L in lines:
        rate = float(str(L.get('rate', f'+{DEFAULT_RATE}%')).strip().rstrip('%'))
        sp = round(1.0 + rate / 100.0, 4)
        speeds0[L['id']] = sp
        entries.append({'id': L['id'], 'text': L.get('say', L['text']),   # say = 同音字；字幕仍用真字
                        'voice': voice, 'speed': sp, 'lang': 'cmn'})
    # ★ lines.json 刻意**不落在 demo 根**（2026-10-04）：编排器（lemo-make.mjs）只要在 demo 根
    #   看到 $D/lines.json，就走 core/tts/tts.py（Kokoro）；而本 demo 的 voice 是 Index-TTS
    #   参考音名（voice_09）⇒ Kokoro 报 unknown voice、音频阶段整条失败。
    #   落到 out/（.gitignore 排除，纯中间产物）就不会被误判；配音由 demo/tts/gen.py 这条
    #   「demo 自带 TTS」路走（见该文件头说明）。
    lp = os.path.join(HERE, 'out', 'lines.json')
    os.makedirs(os.path.dirname(lp), exist_ok=True)
    json.dump(entries, open(lp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('lines.json written:', lp, len(entries), 'lines, voice =', voice, flush=True)

    # 选暂存目录：HERE 本身在 /mnt/<盘> 下就直接用，否则用 STAGE
    if _win_ok(HERE):
        stage_lines, stage_out = lp, os.path.join(HERE, 'vo')
    else:
        os.makedirs(STAGE, exist_ok=True)
        stage_lines, stage_out = os.path.join(STAGE, 'lines.json'), os.path.join(STAGE, 'vo')

    m1 = _synth(entries, voice, stage_lines, stage_out)

    if target:
        # ② 校正语速再合成一遍（原生改时长、不变调）
        speeds2 = {}
        for e in entries:
            t, m = target[e['id']], m1[e['id']]
            speeds2[e['id']] = round(min(2.0, max(0.5, e['speed'] * (m / t))), 4)
        e2 = [dict(e, speed=speeds2[e['id']]) for e in entries]
        print('pass2 speeds:', json.dumps(speeds2, ensure_ascii=False), flush=True)
        m2 = _synth(e2, voice, stage_lines, stage_out)
        # ③ 残余误差用相位声码器微调到精确目标时长
        import librosa, soundfile as sf
        import numpy as np
        for e in entries:
            lid, t, m = e['id'], target[e['id']], m2[e['id']]
            p = os.path.join(stage_out, lid + '.wav')
            if abs(m / t - 1.0) > 0.004:
                y, sr = librosa.load(p, sr=None, mono=True)
                y = librosa.effects.time_stretch(y.astype('float32'), rate=m / t)
                sf.write(p, y, sr)
                print('stretch %s %.3f -> %.3f' % (lid, m, t), flush=True)

    # 拷回本 demo 的 vo/（暂存目录与 HERE 不同时）
    vodir = os.path.join(HERE, 'vo')
    os.makedirs(vodir, exist_ok=True)
    if os.path.abspath(stage_out) != os.path.abspath(vodir):
        for e in entries:
            shutil.copyfile(os.path.join(stage_out, e['id'] + '.wav'),
                            os.path.join(vodir, e['id'] + '.wav'))
        shutil.copyfile(os.path.join(stage_out, 'dur.json'), os.path.join(vodir, 'dur.json'))

    # 重采样到 48 kHz 单声道（时长不变），并重写 dur.json（以磁盘文件为准）
    import soundfile as sf
    import numpy as np
    dur = {}
    for e in entries:
        p = os.path.join(vodir, e['id'] + '.wav')
        y, sr = sf.read(p, always_2d=True)
        y = y.mean(1) if y.shape[1] > 1 else y[:, 0]
        if sr != OUT_SR:
            n = int(round(len(y) * OUT_SR / sr))
            y = np.interp(np.arange(n) / OUT_SR, np.arange(len(y)) / sr, y).astype('float32')
            sf.write(p, y, OUT_SR)
        dur[e['id']] = round(sf.info(p).frames / sf.info(p).samplerate, 3)
        print('vo/%s.wav  dur %.3f%s' % (e['id'], dur[e['id']],
              ('  target %.3f  Δ%+.3f' % (target[e['id']], dur[e['id']] - target[e['id']])) if target else ''), flush=True)
    json.dump(dur, open(os.path.join(vodir, 'dur.json'), 'w', encoding='utf-8'), indent=1)
    print('total', round(sum(dur.values()), 3), flush=True)


if __name__ == '__main__':
    main()
