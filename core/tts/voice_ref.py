#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""voice_ref.py —— 把用户自备音色素材（MP3/M4A/WAV/…）转成 Index-TTS 能用的参考音 wav。

用法：
    python core/tts/voice_ref.py <源音频> <输出wav> [--name <ASCII名>]

例（本机约定：在 WSL 里用库自带的 venv python 跑）：
    wsl -d Ubuntu-24.04 -e bash -lc 'cd /home/lemo/lemo-opuscar && \
        .venv/bin/python core/tts/voice_ref.py \
        "/mnt/d/sucai/gongzuoliusucai/kelongshengyin/华商博主1.MP3" \
        "/mnt/d/sucai/gongzuoliusucai/kelongshengyin/_ref_wav/huashang1.wav" --name huashang1'

为什么要这个工具（三条硬性要求，全是实测踩过的坑，缺一条出来的音色就不能用）：
  1) **必须降电平**。Index-TTS 按参考音的电平出音：参考音顶到满刻度，克隆输出就会顶到
     满刻度（它的保存路径是 clamp(32767*x) 存 int16，**削波不可逆**）。
     ★ 判据的关键是**峰值**，RMS 只作参考 —— 官方 voice_05 就是峰值 1.0 而被弃用的。
     目标水位 mean ≈ -30dB、max ≤ -10dB（与官方健康参考音 voice_12 的 -30.7/-10.2 对齐）。
     实测用户素材常比官方响 15dB（例：某素材 mean -15.5 / peak -0.8，有 6 个采样顶到 0dB）。
     ★ 增益量**逐条实测决定**：gain = min(-30 - 段mean, -10.5 - 段max)，不用固定值。
  2) **必须裁到 6~15 秒**。infer_v2_5 内部按 max_prompt_seconds=15 **静默截断**：超过 15s 的
     部分根本不会被用到；播客式长素材若**前段有片头乐**，音色就跑了 —— 所以必须挑干净区间，
     **不能直接取开头**（挑段判据见 pick_segment）。
  3) **输出规格固定**：单声道 / 44100Hz / 16bit PCM wav（-ac 1 -ar 44100 -c:a pcm_s16le）。
     参考音目录里只有**根下的 .wav** 会被控制台面板列出，所以输出必须落在那个目录的根下。
  另外：参考音的**文件名必须 ASCII** —— 控制台的选项校验（lib/briefs.mjs 的 OPT_RE）只放行
  A-Za-z0-9._-/，中文名进不去。

本工具**只读源文件**：不删源、不改源目录里的任何东西；只写 <输出wav>（必要时建父目录）。

最后一行固定打印一段 JSON（控制台/脚本按它取结果）：
    {"ok":true,"out":"...","name":"huashang1","secs":10.7,"gain_db":-14.5,
     "seg":[5.25,15.95],"before":{"mean":-15.5,"max":-0.8},
     "after":{"mean":-30.0,"max":-15.6},"clipped_samples":0,"warnings":[]}
失败时同样打印 JSON（{"ok":false,"error":"..."}）并以非 0 退出。
"""
import json
import os
import re
import shutil
import subprocess
import sys

try:
    import numpy as np
except ImportError:                     # 分析要用到；WSL 库的 .venv 里一定有
    np = None

# ── 目标水位与挑段参数（都是实测结论，别随手改）──────────────────────────────
REQ_SR      = 44100        # 输出采样率（Index-TTS 走 librosa.load，任意采样率都能读，但统一到 44100）
REQ_CH      = 1            # 输出声道数
TARGET_MEAN = -30.0        # 目标 RMS（dB）—— 对齐官方 voice_12 的 -30.7
TARGET_MAX  = -10.0        # 允许的最大峰值（dB）—— 对齐官方 voice_12 的 -10.2
GAIN_HEAD   = -10.5        # 算增益时给峰值留 0.5dB 余量，不要贴着 -10 走
SEG_MIN     = 6.0          # 最短参考音（秒）
SEG_MAX     = 14.5         # 最长参考音（秒）—— 必须 < 15，见文件头第 2 条
SEG_TARGET  = 12.0         # 挑到干净区域后统一展开到的长度（6~15s 区间的中段）
FRAME       = 0.1          # 分析帧长（秒）
MAX_ROUNDS  = 3            # 电平不达标时最多再降几轮

# 输出文件名的白名单（与控制台 lib/briefs.mjs 的 OPT_RE 同源）
NAME_RE = re.compile(r'^[A-Za-z0-9._-]+$')


def die(msg):
    """失败：打印 JSON 并**非 0 退出**（调用方按退出码判成败）。"""
    print(json.dumps({'ok': False, 'error': str(msg)}, ensure_ascii=False))
    sys.exit(1)


def note(msg):
    """人话进度 —— 走 stderr，不污染最后那行 JSON。"""
    print(msg, file=sys.stderr, flush=True)


# ── 外部工具定位 ────────────────────────────────────────────────────────────
def find_tool(name, env_key):
    """找 ffmpeg / ffprobe：显式环境变量 → PATH → 本机已知的 ffmpeg 目录。

    ★ 为什么不写死路径：本脚本既可能在 WSL 里跑（ffmpeg 在 PATH 上），也可能在 Windows 侧跑
      （ffmpeg 在 D:\\ffmpeg-…\\bin 里，不在 PATH 上）。「能跑就行」，第一个找到的胜出。
    """
    p = os.environ.get(env_key)
    if p and os.path.isfile(p):
        return p
    w = shutil.which(name)
    if w:
        return w
    exe = name + ('.exe' if os.name == 'nt' else '')
    for d in (r'D:\ffmpeg-9.x\ffmpeg-9.0.2-full_build\bin', r'D:\Feijian\_internal'):
        cand = os.path.join(d, exe)
        if os.path.isfile(cand):
            return cand
    return None


# ── 量电平（ffmpeg volumedetect）────────────────────────────────────────────
def _grab_f(text, pat):
    m = re.search(pat, text)
    return float(m.group(1)) if m else None


def measure(ffmpeg, path, start=None, length=None):
    """用 volumedetect 量一段音频的 mean / max（dB）与**顶到 0dB 的采样数**。

    ★ 为什么用 volumedetect 而不是自己算：它是本项目既有的、与官方参考音口径一致的工具；
      而且它顺带给出 `histogram_0db` —— 正好就是「有几个采样顶到 0dB」这个判据，
      不用另写一套阈值（阈值一旦不一致，判据就会漂移）。
    """
    cmd = [ffmpeg, '-hide_banner', '-v', 'info']
    if start is not None:
        cmd += ['-ss', '%.3f' % start]
    cmd += ['-i', path]
    if length is not None:
        cmd += ['-t', '%.3f' % length]
    cmd += ['-ac', str(REQ_CH), '-af', 'volumedetect', '-f', 'null', os.devnull]
    r = subprocess.run(cmd, capture_output=True, text=True, errors='replace')
    text = (r.stdout or '') + (r.stderr or '')
    mean = _grab_f(text, r'mean_volume:\s*(-?[\d.]+)')
    mx = _grab_f(text, r'max_volume:\s*(-?[\d.]+)')
    if mean is None or mx is None:
        tail = ' / '.join([l.strip() for l in text.splitlines() if l.strip()][-3:])
        raise RuntimeError('ffmpeg 量不出电平（文件可能不是音频，或读不出来）：%s' % tail)
    clip = _grab_f(text, r'histogram_0db:\s*(\d+)')
    return {'mean': round(mean, 1), 'max': round(mx, 1), 'clipped': int(clip or 0)}


def probe(ffprobe, path):
    """量源的时长 / 采样率 / 声道数（缺 ffprobe 时由调用方退回 volumedetect 的信息）。"""
    if not ffprobe:
        return {}
    r = subprocess.run(
        [ffprobe, '-v', 'error', '-select_streams', 'a:0', '-show_entries',
         'stream=sample_rate,channels:format=duration', '-of', 'json', path],
        capture_output=True, text=True, errors='replace')
    try:
        j = json.loads(r.stdout or '{}')
    except ValueError:
        return {}
    st = (j.get('streams') or [{}])[0]
    out = {}
    try:
        out['sr'] = int(st.get('sample_rate'))
    except (TypeError, ValueError):
        pass
    try:
        out['ch'] = int(st.get('channels'))
    except (TypeError, ValueError):
        pass
    try:
        out['secs'] = float((j.get('format') or {}).get('duration'))
    except (TypeError, ValueError):
        pass
    return out


def decode(ffmpeg, path, sr, start=None, length=None):
    """解码成单声道 float32（numpy）。分析用；编码交给 ffmpeg 自己做。"""
    cmd = [ffmpeg, '-hide_banner', '-v', 'error']
    if start is not None:
        cmd += ['-ss', '%.3f' % start]
    cmd += ['-i', path]
    if length is not None:
        cmd += ['-t', '%.3f' % length]
    cmd += ['-f', 'f32le', '-ac', '1', '-ar', str(sr), '-']
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        tail = (r.stderr or b'').decode('utf-8', 'replace').strip().splitlines()
        raise RuntimeError('ffmpeg 解码失败：%s' % (' / '.join(tail[-3:]) or ('退出码 %s' % r.returncode)))
    return np.frombuffer(r.stdout, dtype='<f4').astype(np.float64)


# ── 挑段判据 ────────────────────────────────────────────────────────────────
def frame_rms(y, sr, win=FRAME):
    """100ms 帧的 RMS 序列（每帧一个值）。"""
    n = int(round(win * sr))
    f = len(y) // n
    if f < 1:
        return np.zeros(0)
    return np.sqrt((y[:f * n].reshape(f, n) ** 2).mean(axis=1))


def dyn_ratio(fr):
    """100ms 帧 RMS 的 P95/P5 动态比。

    ★ 这个比值**测的就是停顿/静音的多少**：窗口里有整段静音 ⇒ P5 贴近噪声底 ⇒ 比值很大；
      只做 silenceremove 去掉静音，比值就会从 ~162 崩到 ~8（实测）。
    ★ 但**不要**拿它判「有没有背景音乐」：实测一条完全不含音乐的干净参考音，
      只做 silenceremove 也会让比值崩掉 —— 它响应的自始至终是静音，不是音乐。
      判据用错地方比没有判据更糟，这里写明以免后人误用。
    """
    fr = fr[fr > 1e-9]
    if fr.size < 3:
        return 0.0
    p95 = float(np.percentile(fr, 95))
    p5 = float(np.percentile(fr, 5))
    return p95 / max(p5, 1e-12)


def pick_segment(y, sr, total, warnings):
    """挑一段 6~15s 的干净区间。

    做法（与文档一致）：**按 5 秒滑窗扫全轨找动态比最高的区域**，再以它为中心展开成
    SEG_TARGET 秒（12s，落在 6~15s 区间内）的窗口。长度固定、只挑位置 —— 理由见 best_5s。

    ★ 一个必要的护栏：近静音的窗口不要。静音窗口的 P95/P5 也可能很高（噪声底在抖），
      但拿它当参考音毫无意义。所以要求窗口的中位帧 RMS ≥ 全轨 P95 帧 RMS 的 15%。
    """
    if total <= SEG_MAX:
        if total < SEG_MIN:
            warnings.append('源只有 %.2fs，不足 %.0fs —— 无法凑够长度，按原长使用' % (total, SEG_MIN))
        return 0.0, total, None

    fr = frame_rms(y, sr)
    if fr.size < 10:
        warnings.append('源太短或解不出足够的分析帧，退回整轨开头 %.1fs' % SEG_MAX)
        return 0.0, SEG_MAX, None
    loud = float(np.percentile(fr[fr > 1e-9], 95)) if (fr > 1e-9).any() else 0.0
    guard = 0.15 * loud

    def best_5s(min_median):
        """**按 5 秒滑窗扫全轨**，返回动态比最高的那个 5s 窗口（ratio, 起始帧）。

        ★ 为什么用固定的 5s 去找**位置**、而不是直接在 6~15s 里挑最长/最短：
          P95/P5 天然随窗口变短而变大（帧数少 ⇒ 5% 分位更贴极端），实测同一条素材
          14.5s→42908 / 12s→45930 / 10s→50387 / 8s→50844 / 6s→68490 —— 单调上升。
          若把长度也交给「取最大」，结果会**永远**是 6s，6~15s 这个区间就形同虚设。
          所以长度是**约束**（下面统一展开到 SEG_TARGET 秒），比值只用来定位。
        """
        got = None
        n5 = int(round(5.0 / FRAME))
        starts = list(range(0, fr.size - n5 + 1, 5))     # 0.5s 步进
        if starts and starts[-1] != fr.size - n5:
            starts.append(fr.size - n5)                  # 别漏掉尾巴
        for i in starts:
            seg = fr[i:i + n5]
            if min_median is not None and float(np.median(seg)) < min_median:
                continue
            r = dyn_ratio(seg)
            if got is None or r > got[0]:
                got = (r, i)
        return got

    best = best_5s(guard)
    if best is None:                                     # 全轨都偏静音：退回「只按动态比」挑
        warnings.append('全轨都偏静音，已忽略「窗口不能近静音」的护栏')
        best = best_5s(None)
    ratio, bi = best
    # 以最佳 5s 窗口的中心为锚，向两侧展开到目标长度（落在 6~15s 区间内），并夹进轨道
    n5 = int(round(5.0 / FRAME))
    center = (bi + n5 / 2.0) * FRAME
    L = min(SEG_TARGET, total)
    start = max(0.0, min(center - L / 2.0, total - L))
    return start, start + L, ratio


# ── 编码 ────────────────────────────────────────────────────────────────────
def encode(ffmpeg, src, out, start, end, gain_db):
    """裁段 + 施加增益 + 统一输出规格。**只写 out，绝不碰源**。"""
    parent = os.path.dirname(os.path.abspath(out))
    if parent:
        os.makedirs(parent, exist_ok=True)
    cmd = [ffmpeg, '-hide_banner', '-v', 'error', '-y',
           '-ss', '%.3f' % start, '-i', src, '-t', '%.3f' % (end - start),
           '-af', 'volume=%.2fdB' % gain_db,
           '-ac', str(REQ_CH), '-ar', str(REQ_SR), '-c:a', 'pcm_s16le', out]
    r = subprocess.run(cmd, capture_output=True, text=True, errors='replace')
    if r.returncode != 0 or not os.path.isfile(out):
        tail = ' / '.join([l.strip() for l in (r.stderr or '').splitlines() if l.strip()][-3:])
        raise RuntimeError('ffmpeg 写参考音失败：%s' % (tail or ('退出码 %s' % r.returncode)))


# ── 主流程 ──────────────────────────────────────────────────────────────────
def main():
    argv = sys.argv[1:]
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__)
        return 0

    name = None
    pos = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--name':
            i += 1
            if i >= len(argv):
                die('--name 缺少值')
            name = argv[i]
        elif a.startswith('--name='):
            name = a.split('=', 1)[1]
        elif a.startswith('-'):
            die('未知参数 %s（用法：python core/tts/voice_ref.py <源音频> <输出wav> [--name <ASCII名>]）' % a)
        else:
            pos.append(a)
        i += 1
    if len(pos) != 2:
        die('参数不足：需要 <源音频> 与 <输出wav> 两个位置参数'
            '（用法：python core/tts/voice_ref.py <源音频> <输出wav> [--name <ASCII名>]）')

    src, out = pos
    if np is None:
        die('缺少 numpy —— 本脚本用 WSL 库自带的 venv python 跑：'
            '/home/lemo/lemo-opuscar/.venv/bin/python core/tts/voice_ref.py …')
    if not os.path.isfile(src):
        die('源文件不存在：%s' % src)

    # 名字：给了就用给的（必须 ASCII，因为要写进控制台的选项校验）；没给就从输出文件名取
    if not name:
        name = os.path.splitext(os.path.basename(out))[0]
    name = str(name).strip()
    if not name or not NAME_RE.match(name):
        die('音色名必须是 ASCII 且只含 A-Za-z0-9._- ：%r（控制台的选项校验只放行这些字符）' % name)

    ffmpeg = find_tool('ffmpeg', 'VOICE_REF_FFMPEG')
    if not ffmpeg:
        die('找不到 ffmpeg —— 请装 ffmpeg 并放进 PATH，或设环境变量 VOICE_REF_FFMPEG 指向它')
    ffprobe = find_tool('ffprobe', 'VOICE_REF_FFPROBE')

    warnings = []

    # ① 量源
    try:
        info = probe(ffprobe, src)
        before = measure(ffmpeg, src)
    except Exception as e:
        die('量源失败：%s' % e)
    total = info.get('secs')
    if not total:
        # ffprobe 不在/没给出时长 → 用解码长度兜底
        total = None
    if before['clipped'] > 0:
        warnings.append('源有 %d 个采样顶到 0dB（削波不可逆，已整体降电平）' % before['clipped'])
    note('源 %s：%.2fs %sHz %s声道 mean %.1fdB max %.1fdB 顶0dB=%d'
         % (os.path.basename(src), total or 0.0, info.get('sr') or '?', info.get('ch') or '?',
            before['mean'], before['max'], before['clipped']))

    # ② 分析（16kHz 足够判帧 RMS，快得多）→ 挑段
    try:
        y = decode(ffmpeg, src, 16000)
    except Exception as e:
        die('解码源失败：%s' % e)
    if y.size == 0:
        die('源里解不出任何采样（空文件或不是音频）：%s' % src)
    if not total:
        total = y.size / 16000.0
    start, end, ratio = pick_segment(y, 16000, float(total), warnings)
    if end - start < SEG_MIN:
        warnings.append('最终段只有 %.2fs（< %.0fs）' % (end - start, SEG_MIN))
    if end - start > 15.0:
        # 理论到不了（SEG_MAX=14.5），留一道防线：真超了 Index-TTS 会静默截断
        end = start + 15.0
        warnings.append('段超过 15s，已截到 15s（infer_v2_5 只取前 15s）')
    note('挑段 [%.2f, %.2f]s（长 %.2fs，动态比 %s）'
         % (start, end, end - start, ('%.1f' % ratio) if ratio else 'n/a'))

    # ③ 逐条算增益 → 编码 → 复量（不达标再降，最多 MAX_ROUNDS 轮）
    seg = measure(ffmpeg, src, start, end - start)
    gain = min(TARGET_MEAN - seg['mean'], GAIN_HEAD - seg['max'])
    if gain > 0:
        warnings.append('源比目标水位安静，已提升 %.1fdB' % gain)
    after = None
    for rnd in range(1, MAX_ROUNDS + 1):
        try:
            encode(ffmpeg, src, out, start, end, gain)
            after = measure(ffmpeg, out)
        except Exception as e:
            die('写参考音失败：%s' % e)
        ok = (after['max'] <= TARGET_MAX) and (after['clipped'] == 0)
        note('第 %d 轮：gain %.2fdB → mean %.1fdB max %.1fdB 顶0dB=%d %s'
             % (rnd, gain, after['mean'], after['max'], after['clipped'], '✓' if ok else '✗ 再降'))
        if ok:
            break
        if rnd == MAX_ROUNDS:
            die('降了 %d 轮仍不达标（max %.1fdB > %.1fdB 或 顶0dB=%d）—— 源素材可能损坏或过响，'
                '请换一条干净的素材' % (MAX_ROUNDS, after['max'], TARGET_MAX, after['clipped']))
        extra = min(GAIN_HEAD - after['max'], 0.0)      # 保证峰值落回 -10.5 以下
        if extra == 0.0:                                # 峰值够低了但还有顶 0dB（几乎不可能）→ 再降 1dB
            extra = -1.0
        gain += extra

    # 时长/规格以**实际写出的文件**为准（ffmpeg 可能因重采样多/少一帧；报出来的必须是真的）
    real = end - start
    try:
        ri = probe(ffprobe, out)
        if ri.get('secs'):
            real = float(ri['secs'])
        if ri.get('sr') and ri['sr'] != REQ_SR:
            warnings.append('输出采样率是 %sHz，不是 %sHz' % (ri['sr'], REQ_SR))
        if ri.get('ch') and ri['ch'] != REQ_CH:
            warnings.append('输出是 %s 声道，不是单声道' % ri['ch'])
    except Exception:
        pass
    print(json.dumps({
        'ok': True,
        'out': os.path.abspath(out),
        'name': name,
        'secs': round(real, 1),
        'gain_db': round(gain, 1),
        'seg': [round(start, 2), round(end, 2)],
        'before': {'mean': before['mean'], 'max': before['max']},
        'after': {'mean': after['mean'], 'max': after['max']},
        'clipped_samples': after['clipped'],
        'warnings': warnings,
    }, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:              # 兜底：任何未预期异常也要给 JSON + 非 0
        die('%s: %s' % (type(e).__name__, e))
