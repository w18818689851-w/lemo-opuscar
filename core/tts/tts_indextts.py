"""Index-TTS 本地配音（离线，用户本机部署的 Index-TTS 2.5 便携版）：
    python core/tts/tts_indextts.py lines.json out_dir

接口与 core/tts/tts.py（Kokoro）完全一致，下游（mix.py / 影片页面的 dur.json）不用改：
  lines.json = [{"id":..., "text":..., "voice":..., "speed":1.0, "lang":"cmn"}, ...]
  输出 out_dir/<id>.wav（22050Hz 单声道 16bit，去首尾静音）与 out_dir/dur.json
  逐条打印 "<id> <时长秒> <文本>"；任何一条失败就非 0 退出并点名是哪条。

voice 字段的约定（**不是** Kokoro 那种音色名）：
  1) 音色别名：内置 VOICE_ALIASES 里的键（默认 'zh_curator'）→ 映射到某个官方参考音频；
     也可以直接写 'voice_07' 这种官方参考音名。**目录里实际有哪些以 available_refs() 为准**
     （本机实测：voice_01–09 / 11 / 12 + emo_hate / emo_sad，**没有 voice_10**）；
     写了目录里没有的名字会直接报错，并把可用清单打出来。
  2) 参考音频路径：值里含 '/' 或 '\\'，或以 .wav 结尾 → 当成路径（绝对路径，或相对 REF_DIR）。
     路径不存在就报错退出。
  用官方参考音做**零样本音色克隆**，所以「换一个音色」= 换一个参考 wav。

为什么要把参考音和代码分开：Index-TTS 不认音色名，只认参考音频；别名只是给内容文件一个稳定的锚点。

★ 本机是 Windows 便携版应用，必须用它自带的 venv python（app/.venv/Scripts/python.exe）跑；
  本脚本用**自重入**实现：外面的进程做校验/路径转换，再用那个 python 重新执行自己（见 _LEMO_INDEXTTS_INNER）。
  **一次进程加载模型、批量合成全部行**——模型加载一次要 1~2 分钟，逐条起进程完全不可接受。
  选它而不是 CLI 的 batch 子命令，是因为便携版的 cli_v2.py 走的是旧版推理路径
  （indextts.infer_v2，没有 lang / duration_factor，见下面「时长」一节），
  用它会丢掉 checkpoint 里的 lang_embedding / spk_emb_proj，合成结果不可用。

可配置项（**都是环境变量**，改这里就行，不要散落硬编码）：
  INDEXTTS_HOME    便携版根目录         默认 D:/Index-tts/Index-tts_v2.5
  INDEXTTS_APP     应用目录（cwd）      默认 $INDEXTTS_HOME/app
  INDEXTTS_PYTHON  Windows venv python  默认 $INDEXTTS_APP/.venv/Scripts/python.exe
  INDEXTTS_REF_DIR 官方参考音目录       默认 $INDEXTTS_HOME/官方测试素材/参考音频
  INDEXTTS_ENGINE  推理路径 v2_5 | v2   默认 v2_5（v2_5 = 官方 2.5 路径，见下）
  INDEXTTS_QUANT   v2_5: bf16|fp32；v2: fp16|fp32    默认 bf16
  INDEXTTS_DEVICE  设备，空=自动        默认空
  INDEXTTS_TIMEOUT 子进程超时秒         默认 3600

★ 这些变量**谁读**（2026-10-05 实测；决定了「在哪儿设才有用」）：
  · **外层读**：HOME / APP / PYTHON / REF_DIR / VOICE_LIB / TIMEOUT / STALL_TIMEOUT / LOCK*
    —— 外层就是跑本文件的这个 python，它在 WSL 里，export 就能读到。
  · **内层读**：ENGINE / QUANT / DEVICE / MIN_FREE_MIB
    —— 只有内层（Windows venv python）用得上。而 **WSL→Windows interop 不传环境变量**，
      所以外层会从自己的环境里取出这四项、翻译成 `--engine=… --quant=… --device=…
      --min-free-mib=…` 交给内层（见 main / apply_inner_argv）。
    ⇒ 在 **WSL 里 export** 有效（外层读到 → argv → 内层）；
      在 **Windows 侧设系统环境变量**也有效（外层没设就不带参数，内层按自己的环境读）。
    ★ 生效值每次都会打在内层配置行上（`tts_indextts.py: 内层配置 —— …`），可当场核对。

时长（实测结论，2026-10）：
  · 便携版 CLI（indextts.cli_v2 synth/batch）走 indextts.infer_v2，即 **IndexTTS-2（v2.0）的推理代码**，
    而 checkpoints 是 **2.5 的权重**：加载时会 "skipping unexpected keys: spk_emb_proj.weight,
    spk_emb_proj.bias, lang_embedding.weight"。用它合成 20 个汉字只出 ~1.35 秒（约 15 字/秒，不可能）。
  · 官方 2.5 的推理入口是 indextts.infer_v2_5.IndexTTS2，多出 lang（语言前缀 token）与
    duration_factor（语速，>1 变慢，0.5–2.0）两个参数，且用 campplus 说话人条件 + 2.5 的多语言 tokenizer。
    本脚本默认走这条路径（INDEXTTS_ENGINE=v2_5）。
  · speed 字段映射到 duration_factor = 1/speed（v2_5 原生改时长、不变调）；v2 路径退化成
    librosa 变调保持的时间伸缩。
"""
import json, os, re, subprocess, sys

# ── 可配置项 ──────────────────────────────────────────────────────────────────
def _env_int(name, default):
    """读一个整数环境变量。非法值**明确报错**，既不静默回落、也不抛裸 traceback。

    ★ 2026-10-05：原来这里是 `int(os.environ.get(...))`，`INDEXTTS_MIN_FREE_MIB=abc` 会抛一个
      裸 `ValueError: invalid literal for int()...` —— 看得出崩了，但看不出是**哪个**变量、
      该怎么改。而这条变量正是「显存不够时唯一的逃生口」（见 precheck_vram），
      设错时的报错必须能直接照做。
    """
    raw = os.environ.get(name)
    if raw is None or raw.strip() == '':
        return default
    try:
        return int(raw)
    except ValueError:
        sys.exit(f'tts_indextts.py: {name}={raw!r} is not an integer — set it to a whole number, '
                 f'or unset it to use the default ({default}).')


HOME    = os.environ.get('INDEXTTS_HOME', 'D:/Index-tts/Index-tts_v2.5')
APP     = os.environ.get('INDEXTTS_APP', os.path.join(HOME, 'app'))
PYTHON  = os.environ.get('INDEXTTS_PYTHON', os.path.join(APP, '.venv', 'Scripts', 'python.exe'))
REF_DIR = os.environ.get('INDEXTTS_REF_DIR', os.path.join(HOME, '官方测试素材', '参考音频'))
ENGINE  = os.environ.get('INDEXTTS_ENGINE', 'v2_5')
QUANT   = os.environ.get('INDEXTTS_QUANT', 'bf16')
DEVICE  = os.environ.get('INDEXTTS_DEVICE', '')
TIMEOUT = int(os.environ.get('INDEXTTS_TIMEOUT', '3600'))
# ★ 看门狗：外层等内层时，内层「活着但毫无进展」超过这么多秒就判定卡住（见 run_with_watchdog）。
#   设 0 关闭看门狗。推导见 run_with_watchdog() 的注释 —— **别把它改小**，会误杀正常的慢任务。
STALL_TIMEOUT = int(os.environ.get('INDEXTTS_STALL_TIMEOUT', '300'))
# ★ 加载模型前要求的最小可用显存（MiB）。见 precheck_vram() 处的实测推导。
#   设 0 可关掉这道检查。
#   ★ 2026-10-05 由 7300 下调到 6700：重新实测后，本机最长参考音（13.5s）的真实峰值只要
#     6468 MiB（12s 的 kepu9 只要 6318），而 7300 会把「可用 7019 MiB」这种**跑得通**的
#     状态误杀掉 —— dub 通路（dub.mjs 默认音色 kepu9）在本机默认状态下就是这么被拦住的。
#     推导与校验见 precheck_vram() 的 docstring。
VRAM_MIN_MIB = _env_int('INDEXTTS_MIN_FREE_MIB', 6700)

# ★ 「内层读」的配置项 → 传给内层的命令行参数（2026-10-05）。三元组：环境变量名 → 参数名 → 内层全局名。
#   为什么必须走 argv：**WSL→Windows 的 interop 完全不传环境变量**（实测：WSL 里 export 一个探针，
#   那个 Windows python 的 os.environ 里读不到；反向同样）。而 main() 传给 Popen 的 env= 已经是
#   `dict(os.environ)` 的**完整副本**，内层照样一个都读不到 ⇒ 只改 env= 是没用的，只能走 argv。
#   ★ 只有下面这四项是「内层读」；INDEXTTS_HOME / APP / PYTHON / REF_DIR / VOICE_LIB / TIMEOUT /
#     STALL_TIMEOUT / LOCK* 都是**外层读**的 —— 外层在 WSL 里，export 就能看到，不需要走 argv。
#   ★ 第三个元素不能由前两个推出来（INDEXTTS_MIN_FREE_MIB → VRAM_MIN_MIB），所以显式写死。
INNER_OPTS = (
    ('INDEXTTS_ENGINE',       '--engine',       'ENGINE'),
    ('INDEXTTS_QUANT',        '--quant',        'QUANT'),
    ('INDEXTTS_DEVICE',       '--device',       'DEVICE'),
    ('INDEXTTS_MIN_FREE_MIB', '--min-free-mib', 'VRAM_MIN_MIB'),
)

# 音色别名 → 官方参考音频文件名。别名是给内容文件用的稳定锚点；换音色 = 换一个参考 wav。
# 选型依据（2026-10 实测：11 个官方参考音各合成同一句 20 字，量中位基频 / 语速 / 克隆保真度 / 削波）：
#   zh_curator     = voice_12  男声，中位基频 95Hz → 克隆后 99Hz（11 个里保真度最高）；语速最慢最沉；
#                              参考音最干净（噪声底 0.0003）；输出峰值 0.36–0.67，不削波。缺点：参考音只有 2.7s。
#   zh_curator_alt = voice_06  男声（173Hz→202Hz），6.2s 参考音（更长、更稳），输出峰值 0.51，不削波。
# 没有选 voice_05：它是唯一 8.4s 的长参考音，但录得太响（峰值 1.0 / RMS 0.21，是别人的 4 倍），
#   克隆出来的 9 条全部顶到满刻度削波（0.07%–1.5% 采样）—— 削波不可逆，宁可要安静的参考音。
VOICE_ALIASES = {
    'zh_curator':     'voice_12.wav',
    'zh_curator_alt': 'voice_06.wav',
}
# ★ 用户自备音色库（2026-10-02 新增）。Index-TTS 只认参考音频，用户手上那批「克隆声音」
#   是 MP3，不能直接当参考音（soundfile 对 MP3 支持不稳），必须先转成 wav 放进这个目录。
#   转换脚本见 tools/mp3_to_ref.sh（统一降电平 + 裁到 6~15s，理由见下）。
#   查名顺序：别名 → voice_NN（官方）→ 音色库 → 报错。所以库里的名字可以直接写进内容文件的 voice 字段。
LIB_DIR = os.environ.get('INDEXTTS_VOICE_LIB',
                         'D:/sucai/gongzuoliusucai/kelongshengyin/_ref_wav')
# 音色库里的名字 → 别名（给内容文件一个稳定锚点，不随文件名改动而失效）
LIB_ALIASES = {
    # 科普博主9：44100 单声道 12.0s，mean -30.0 / max -14.5 dB。
    # ★ 2026-10-02 起指向 voice_ref.py（控制台「导入音色」用的同一个转换器）的产物 —— 它逐条实测算增益、
    #   精准落在目标水位，比最早那份手工做的（kepu9_ref.wav，10.7s / -29.5 / -15.6）更规范、也更长更稳。
    #   旧那份已移到 _ref_wav/_test/ 留档。别名跟着换，是为了让面板上这个音色只出现一次
    #   （available_lib 会把已被别名覆盖的库内同名 wav 跳过）。
    'zh_kepu9': 'kepu9.wav',
}
# ★ 参考音预检阈值（2026-10-02 新增）。依据：官方 voice_05 因录得太响（peak 1.0 / RMS 0.21，
#   是别人的 4 倍）克隆出 9 条全部削波而弃用；用户自备的「科普博主9」原始 MP3 是 peak -0.8 /
#   mean -15.5 dB，同样属于「太响」，直接拿来用必然削波。宁可在这里报出来，也不要出了片子才发现。
REF_PEAK_WARN = 0.90     # 峰值超过它 → 警告（0.9 ≈ -0.9 dBFS）
# ★ 2026-10-02 按实测收紧：原来定 0.12（≈ -18.4 dBFS），结果 18 条里有 5 条触发 ——
#   但其中只有 voice_05（peak **1.0**）是真削波；voice_03/08（peak 0.56）、voice_02（0.82）、
#   emo_hate（0.56）只是录得响，**余量充足**，拿它们克隆并不削波（实测过）。
#   判据的关键是**峰值**：Index-TTS 按参考音的电平出音，顶到满刻度的才是真风险；
#   RMS 只说明「录得响」，单独用它会把正常素材误报成危险。
#   取 0.18 后恰好只有 voice_05 触发，与文档记载的史实（voice_05 因削波被弃用）完全对上。
REF_RMS_WARN  = 0.18     # RMS 超过它 → 警告（0.18 ≈ -14.9 dBFS）
DEFAULT_VOICE = 'zh_curator'

CJK = re.compile('[぀-ヿ㐀-鿿가-힯豈-﫿]')


# ── 路径工具（外层可能跑在 WSL 的 python 下，内层是 Windows python）──────────────
def win_path(p):
    """把 WSL 的 /mnt/d/foo 换成 Windows 的 D:/foo；已是 Windows 路径就原样返回。"""
    m = re.match(r'^/mnt/([a-zA-Z])/(.*)$', p)
    if m:
        return f'{m.group(1).upper()}:/{m.group(2)}'
    return p


def is_path_like(v):
    """值像不像一个路径。
    ★ 2026-10-02 修：原来只认 '/'、'\\'、'.wav'，于是 `D:foo.wav`（Windows 盘符相对路径）
      与 `.MP3`/`.m4a`/`.flac` 这些都被当成「音色名」，报出误导性的 unknown voice。
      盘符形式 `^[A-Za-z]:` 与常见音频扩展名都算路径。
    """
    return (re.match(r'^[A-Za-z]:', v) is not None
            or '/' in v or '\\' in v
            or re.search(r'\.(wav|mp3|m4a|flac|aac|ogg|opus)$', v, re.I) is not None)


def available_lib():
    """音色库里**真实存在**的参考 wav 名（不含扩展名）。与 available_refs 同理：提示里承诺的必须真的存在。"""
    d = host_path(LIB_DIR)
    try:
        return sorted(f[:-4] for f in os.listdir(d) if f.lower().endswith('.wav'))
    except OSError:
        return []


def available_refs():
    """官方参考音目录里**真实存在**的 .wav 名（不含扩展名）。

    ★ 提示文案必须用这个，而不是硬编码区间：目录里实测缺 `voice_10`（只有 voice_01–09 / 11 / 12，
      另有 emo_hate / emo_sad），写死 `'voice_01'..'voice_12'` 会让用户照提示写 voice_10，
      却拿到「reference audio not found」。**提示里承诺的，必须真的存在。**
      走 host_path 是因为外层可能跑在 WSL（REF_DIR 是 Windows 路径，WSL 里要转成 /mnt/<盘符>/…）。
    """
    d = host_path(REF_DIR)
    try:
        return sorted(f[:-4] for f in os.listdir(d) if f.lower().endswith('.wav'))
    except OSError:
        return []


def resolve_voice(v):
    """音色别名 / 音色库名 / voice_07 / 参考音频路径 → 参考音频的绝对路径。

    查名顺序：**路径 → 别名 → 音色库别名 → voice_NN（官方）→ 音色库同名 wav → 报错**。
    ★ 2026-10-02 修两个坑：
      ① 原来用 `os.path.isabs()` 判绝对路径 —— 它在 WSL 下对 `D:/x.wav` 返回 False，
         于是 Windows 绝对路径被拼到 REF_DIR 后面，变成不存在的路径。改成认盘符形式。
      ② 原来只认官方 REF_DIR，用户自备音色库进不来（想用只能写绝对路径）。现在加了 LIB_DIR。
    """
    if not v:
        v = DEFAULT_VOICE
    if is_path_like(v):
        p = win_path(v)
        # 盘符形式（D:/x.wav）已经是绝对路径；其余（裸文件名、相对路径）按 音色库 → 官方 的顺序找
        if not re.match(r'^[A-Za-z]:', p) and not os.path.isabs(p):
            for base in (LIB_DIR, REF_DIR):
                cand = os.path.join(base, p)
                if os.path.isfile(host_path(cand)):
                    return cand
            p = os.path.join(REF_DIR, p)
        return p
    if v in VOICE_ALIASES:
        return os.path.join(REF_DIR, VOICE_ALIASES[v])
    if v in LIB_ALIASES:
        return os.path.join(LIB_DIR, LIB_ALIASES[v])
    if re.fullmatch(r'voice_\d+', v):
        p = os.path.join(REF_DIR, v + '.wav')
        # 目录在、但这个文件不在 → 别装作认识它，落到下面统一的提示（实测目录里没有 voice_10）。
        # 目录本身不在（没装 Index-TTS / REF_DIR 指错）→ 原样返回，交给后面的存在性检查报「文件不存在」，
        # 免得把「目录缺失」误报成「这个音色名不认识」。
        if not os.path.isdir(host_path(REF_DIR)) or os.path.isfile(host_path(p)):
            return p
    # 音色库里的同名 wav（用户自己那批克隆声音，转换后放在 LIB_DIR）
    p = os.path.join(LIB_DIR, v + '.wav')
    if os.path.isfile(host_path(p)):
        return p
    refs, libs = available_refs(), available_lib()
    raise SystemExit(
        f"tts_indextts.py: unknown voice '{v}'.\n"
        f"  use an alias ({', '.join(sorted(VOICE_ALIASES) + sorted(LIB_ALIASES))}),\n"
        f"  a reference clip in {REF_DIR}" + (f" ({', '.join(refs)})" if refs else "") + ",\n"
        f"  a clip in the voice library {LIB_DIR}" + (f" ({', '.join(libs)})" if libs else "") + ",\n"
        f"  or a path to a reference audio file")


# ── 内层：在 Windows venv 里真正跑模型（本文件被重新执行一次，靠 --inner 参数分辨）──
def apply_inner_argv(argv):
    """把外层翻译过来的 `--engine=… --quant=… --device=… --min-free-mib=…` 落到全局配置上。

    ★ 为什么必须走 argv（2026-10-05 实测）：WSL→Windows interop **不传环境变量** ——
      main() 里 Popen 的 env= 传的就是 `dict(os.environ)` 的完整副本，内层照样一个都读不到。
      所以这四项「内层读」的配置只有命令行参数这条路能真正进来。
    ★ 参数**优先于环境变量**：外层（WSL）读到的用户设置必须能盖过内层自己继承的 Windows 环境。
    ★ 外层**没设**的项不会带参数过来 ⇒ 内层保持自己的默认值；于是「在 Windows 侧用系统环境
      变量设的值」也仍然有效（实测：Windows 侧 set 的变量能进内层）—— 两条路都不丢。
    """
    by_flag = {flag: name for _var, flag, name in INNER_OPTS}
    for a in argv:
        if not a.startswith('--') or '=' not in a:
            continue
        flag, val = a.split('=', 1)
        var = by_flag.get(flag)
        if var is None:
            continue
        if var == 'VRAM_MIN_MIB':
            try:
                val = int(val)
            except ValueError:
                sys.exit(f'tts_indextts.py: INDEXTTS_MIN_FREE_MIB={val!r} is not an integer — '
                         f'set it to a number of MiB (0 disables the free-VRAM check).')
        globals()[var] = val


def _free_vram_mib():
    """返回 (可用 MiB, 总 MiB, 数据来源)；两条路都失败就返回 (None, None, 原因)。

    ★ 主判据是 **nvidia-smi**，不是 torch.cuda.mem_get_info()：本卡是 WDDM 模式，
      mem_get_info 报的是「WDDM 愿意为本进程腾出的量」，别的进程占多少它都不变
      （实测：空载与 LM Studio 占 7868 MiB 时，它都回同一个 7106 MiB）——
      拿它当判据这道检查永远不会触发。理由详见 precheck_vram() 的注释。
    """
    # ① nvidia-smi：设备级真相（和事故现场定位用的是同一个读数）
    try:
        r = subprocess.run(
            ['nvidia-smi', '--query-gpu=memory.used,memory.total', '--format=csv,noheader'],
            capture_output=True, text=True, timeout=15)
        if r.returncode == 0:
            # 输出形如 "249 MiB, 8188 MiB"；多卡时每行一张，取第一张（本机只有一张）
            line = (r.stdout or '').strip().splitlines()[0]
            used_s, total_s = [x.strip() for x in line.split(',')]
            used = int(used_s.split()[0])
            total = int(total_s.split()[0])
            return max(0, total - used), total, 'nvidia-smi'
    except Exception:
        pass
    # ② 退路：torch（读数在 WDDM 下偏乐观，仅当 nvidia-smi 不可用时用）
    try:
        import torch
        if torch.cuda.is_available():
            free_b, total_b = torch.cuda.mem_get_info()
            return (int(free_b) // (1024 * 1024), int(total_b) // (1024 * 1024),
                    'torch.cuda.mem_get_info（WDDM 下偏乐观，仅供参考）')
    except Exception:
        pass
    return None, None, 'nvidia-smi 与 torch 都读不到'


def precheck_vram():
    """加载模型**之前**的显存预检：不够就明确报错退出，而不是静默挂死。

    ★ 为什么要这道检查（2026-10-02 事故，整套流水线静默挂死一个多小时）：
      本机只有一张 8GB 卡，两个能力抢它。语义解析先调本机 LM Studio 的大模型
      （实测把显存吃到 7174 / 8188 MiB），之后 Index-TTS 加载不进显存就
      **无限挂起**：tts_indextts.py 挂 25 分钟、`_tts/` 一个 wav 都不出、GPU 利用率 5%、
      **一句报错都没有**。上层只能靠超时发现，而且从日志里看不出是显存的问题。
      ⇒ 显存不够时**秒回**并说清原因，是这个失败模式唯一的正确解法。

    ★ 为什么**不用** `torch.cuda.mem_get_info()`（2026-10-02 实测，这是这道检查最关键的一步）：
      本卡跑在 **WDDM** 模式下（`nvidia-smi` 头一行写着 `... RTX 4060  WDDM`）。
      实测：`torch.cuda.mem_get_info()` **无论别的进程占多少，都稳定回 7106 MiB / 8187 MiB** ——
        · 空载（nvidia-smi 显示 234 MiB 已用）→ mem_get_info 说可用 7106 MiB；
        · LM Studio 加载着 7B 模型（nvidia-smi 显示 **7868 MiB 已用**）→ mem_get_info **还是说 7106 MiB**。
      也就是说它报的是「WDDM 愿意为**本进程**腾出来的量」（可以把别人的显存换页到内存），
      而不是设备还剩多少 —— 拿它当阈值判据，**这道检查永远不会触发**，等于没写。
      ⇒ 所以主判据改成 `nvidia-smi --query-gpu=memory.used,memory.total`（设备级真相，
        也就是事故现场用来定位的那个读数）；mem_get_info 只作为**退路**（并在输出里注明来源）。

    ★ 阈值怎么来的（**2026-10-05 重新实测**，不是拍脑袋）：
      实测过程（本机 RTX 4060 8GB / WDDM，ENGINE=v2_5 / QUANT=bf16；用脚本自带入口跑**真** TTS，
      `nvidia-smi --query-gpu=memory.used` 每 0.25s 采样取峰值）——
        ① 本底（跑之前，浏览器 / 控制台常驻）：**958–977 MiB**（总 8188）；
        ② 参考音 voice_12（2.67s）：峰值 6808 ⇒ **增量 5850**；
        ③ 参考音 kepu9（12.0s，= dub.mjs 的默认音色）：峰值 7223–7272 ⇒ **增量 6264–6314**
           （极短句 6264 / 同输入复跑 6265 / 33 字长句 6314 —— **峰值高度可重复**）；
        ④ 参考音 suran_male（**13.5s，本机可用参考音里最长**）：峰值 7426 ⇒ **增量 6468**；
        ⑤ 10 句批量（kepu9）：峰值 7277 ⇒ 增量 6318 —— **多句不累积**，与单句同一档；
        ⑥ 六次跑完都回落到本底（958），**不留常驻**。
      ⇒ **需求随参考音长度变化**（Index-TTS 把参考音编成 prompt，越长 KV cache 越大）：
        voice_12(2.67s) 5850 / kepu9(12s) 6318 / suran_male(13.5s) 6468。
        dub 默认的 kepu9 只要 6318。
      ★★ **需求上界由「引擎的 15s prompt 截断」决定，不是由「本机磁盘上最长的那条参考音」决定**
        （**2026-10-07 复测修正**。原注释写「本机最长参考音 13.5s 的 6468 MiB 就是需求上界」，
         那是**把偶当成了必然** —— 本机恰好没有更长的参考音而已）：
        · 引擎侧：infer_v2_5 加载参考音时就**硬截到 15s**（`_load_and_cut_audio(spk_audio_prompt, 15, …)`，
          见 `indextts/infer_v2_5.py` 的 infer_generator），所以**再长的参考音也只按 15s 计费**，
          15s 就是需求的天花板；
        · 生产侧：参考音由 `core/tts/voice_ref.py` 产出，它规定 `SEG_MAX = 14.5` / `SEG_TARGET = 12.0`，
          所以生产上真实可出现的上限是 **14.5s**。
      ★ 2026-10-07 复测（**200ms 采样，8 次实跑**；增量 = 峰值 used − 跑前本底 used）——
        参考音时长 → **增量**：2.673s→5706 · 12.0s→6314 · 13.5s→6466 / 6485（复跑）
        · 14.5s→6556 · 15.0s→6635 / 6639（复跑）。近似 **+100 MiB / 秒**（8s 以上）。
        ⇒ 引擎 15s 上限的需求是 **~6635–6639**（比 6468 高约 170 MiB）；14.5s 是 **6556**；
          本机磁盘上实际最长的 13.5s 是 **6466–6485**（与 2026-10-05 的 6468 完全吻合）。
      ★ 2026-10-07 新驱动复测（**NVIDIA 617.42**，驱动更新后重验；同法 200ms 采样、真 TTS 4 次实跑，
        本底 455–463 MiB / 总 8188）——**平台峰值 6924 / 6924 / 6927**（suran_male 13.5s，三次，
        复跑抖动仅 3 MiB）；kepu9 12.0s → 6782。增量 = 平台峰值 − 跑前本底：
        13.5s → **6466 / 6469 / 6472** · 12.0s → **6322** —— 与上面 6466–6485 / 6314 **逐项吻合
        （差 ≤ 8 MiB）** ⇒ **驱动升到 617.42 未改变显存需求，6700 门槛仍成立**。
        · 唯一异常：某次跑捕到 **1 个采样点 7027**（比平台高 105，仅 1/200ms 点，另三次未复现）
          —— 判为瞬时分配或 nvidia-smi 读数抖动；即便按它算增量也只有 **6572 < 6700**。
      ★ **峰值 = 本底 + 固定增量，只有「增量」是不变量**（2026-10-07 证）：
        复测时本底只有 ~392 MiB，绝对峰值比 2026-10-05 的读数低 566 MiB —— **恰好等于两次本底之差**
        （958 − 392 = 566）。又用 torch 持 600 MiB 把本底抬到 1070 复跑同一输入：增量仍是 **6465**。
        ⇒ 阈值比的是「跑之前还剩多少空闲」，即把**增量**当成「跑前必须预留的量」，模型成立；
          绝对峰值随桌面本底漂移，**不可**拿来当阈值依据。
      ★ 阈值取 **6700 = 6468 + 232（≈4% 余量）**（数字未动，2026-10-05 定的）；
        余量用来吸收「采样可能漏掉的尖峰 + 显存碎片」。2026-10-07 补上**余量账**
        （跑前空闲恰好 = 6700 时，峰值后还剩多少）：
          · 13.5s 需 6466 ⇒ 剩 **234** MiB —— ≈ 观测抖动的 **12 倍**（同输入复跑抖动仅 4–19 MiB）⇒ **充裕**；
          · 14.5s 需 6556 ⇒ 剩 **144** MiB；
          · 15.0s 需 6635 ⇒ 剩 **65** MiB —— **偏薄，但不会 OOM**（实测峰值后仍剩 1160 MiB，因本底低）。
      ★★ 为什么**不往上调**：抬到 6870（= 6639 + 232）只会让失败**更多** —— 多出的 ~170 MiB
        只在「空闲 6700–6870」这条窄带里起作用；而实测的失败发生在空闲 **2900–5600**
        （桌面本底 2.6–5.3 GB：浏览器 / WebView2 / 别的项目的无头 chrome），差 1100–3800 MiB，
        **任何阈值都救不了**。那种情形是**环境**问题（去腾显存），不是阈值问题。
      ★★ 为什么**不往下调（禁止）**：空闲 2900–5600 时模型硬需求 6466，差 1–3.5 GB；
        放行 = 复现本函数开头那次「静默挂死一个多小时、零报错」的事故 —— 正是这道检查要防的。
      校验（对照本机实测的空闲水位）：
        · 空载可用 ~7019–7230（本底 958–1169）⇒ 6700 **能过，dub 默认通路跑得通**；
          旧的 7300 在这里会**误杀** —— 可用 7019 < 7300，但实际只需 6468，
          本次实测在可用 7208 的情况下连跑 6 次全部成功（峰值 7223–7426）。
        · 事故现场 LM Studio 占着 7174 MiB ⇒ 可用只剩 ~1014 ⇒ **必然被拦下**（6 倍余量）；
        · 另一个 TTS 正在跑（实测占用 6561 MiB）⇒ 可用 ~1627 ⇒ 也会被拦下（本来就不该并发）。
      ★★ 诚实的边界（别把它当保证）：本机 8GB 卡跑最长的 13.5s 参考音时峰值 7426/8188，
         余量只剩 762 MiB。这道检查拦的是「显存被大模型整块吃掉」这类**量级上的**不足
         （差 5~6 GB），拦不住「差 100 MiB」那种边界情况 —— 那需要更大的卡，不是阈值能解决的。
      ★ 如果你实测发现 Index-TTS 只需要 2GB，就把这个值改小 —— 别用它误杀正常情况。

    ★ 检查本身**绝不能成为新的失败点**，分两档：
      · 两条路都拿不到显存信息 → 一律**跳过检查**并打一行说明，而不是报错退出；
      · 只有 nvidia-smi 不可用、退路 torch 报出读数 → **只警告、不拦截**。
        理由见下面 `if src != 'nvidia-smi'` 那段：torch 的读数在 WDDM 下失真，而且
        **恰好低于本阈值**（实测真实可用 7933 MiB 时它报 6625–7106 MiB），
        让它参与拦截的话，nvidia-smi 不可用的机器上 Index-TTS 会**永远起不来** ——
        那就正好犯下这道检查本要避免的那个错。
    """
    if VRAM_MIN_MIB <= 0:
        return
    free_mib, total_mib, src = _free_vram_mib()
    if free_mib is None:
        print(f'tts_indextts.py: warning: 显存预检已跳过 —— 拿不到显存信息（{src}）',
              file=sys.stderr)
        return
    print(f'tts_indextts.py: 显存预检 —— 可用 {free_mib} MiB / 共 {total_mib} MiB'
          f'（{src}），需要至少 {VRAM_MIN_MIB} MiB', flush=True)
    # ★ 只有**可信来源**（nvidia-smi）才允许拦截。
    #   2026-10-02 实测：monkeypatch 掉 nvidia-smi 那条路后，退路 torch.cuda.mem_get_info() 返回
    #   可用 6625 MiB / 共 8187 MiB —— 低于阈值 7300 ⇒ 会 sys.exit(1)。但同一时刻 `nvidia-smi`
    #   报的是「已用 7296 / 8188」（即真的被 7B 占着，拦得对）；而真实空闲时它也回 7106（拦得错）。
    #   结论：这个读数**不能用来拦截**，否则 nvidia-smi 不可用的环境里 Index-TTS 永远起不来。
    if src != 'nvidia-smi':
        if free_mib < VRAM_MIN_MIB:
            print(f'tts_indextts.py: warning: 可用显存 {free_mib} MiB 低于阈值 {VRAM_MIN_MIB} MiB'
                  f'（差 {VRAM_MIN_MIB - free_mib} MiB），但该读数来自退路（{src}），'
                  f'在 WDDM 下不可信 —— 只警告，不拦截。\n'
                  f'  若随后真的挂死或慢得离谱，请腾显存后重跑：关掉浏览器 / 控制台页面 / '
                  f'LM Studio 常驻模型，用 `nvidia-smi` 确认可用显存上来了再跑。',
                  file=sys.stderr, flush=True)
        return
    if free_mib < VRAM_MIN_MIB:
        sys.exit(
            f'tts_indextts.py: 显存不足，拒绝加载 Index-TTS（否则会无限挂起且不报错）。\n'
            f'  当前可用显存: {free_mib} MiB / 共 {total_mib} MiB（来自 {src}）\n'
            f'  需要至少:     {VRAM_MIN_MIB} MiB（还差 {VRAM_MIN_MIB - free_mib} MiB）\n'
            f'  两条出路：\n'
            f'    ① 腾显存（推荐）：关掉正在用这张卡的程序再重跑。最常占的是浏览器、控制台页面、\n'
            f'       LM Studio 常驻的大模型 —— 在 LM Studio 里卸载模型、或把模型配成 num_gpu=0\n'
            f'       走 CPU 内存即可。跑 `nvidia-smi` 能看到当前占用与剩余。\n'
            f'    ② 显式放行（自担风险）：设 INDEXTTS_MIN_FREE_MIB={max(0, free_mib - 300)}\n'
            f'       （= 当前可用 {free_mib} MiB 再留 300 MiB）后重跑。放行后若显存真的不够，\n'
            f'       Index-TTS 会**静默挂死**——正是这道检查要防的事。\n'
            f'       ★ 该变量从 WSL（dub.mjs / lemo-make 的调用链）**也有效**：外层会把它翻译成\n'
            f'         `--min-free-mib={max(0, free_mib - 300)}` 交给内层（WSL→Windows 不传环境变量，\n'
            f'         所以走 argv，见 main / apply_inner_argv）。设完重跑即可，生效值会打在内层配置行上。'
        )


def run_inner(lines_path, out_dir):
    # ★ 生效配置自报 + 合法性检查（2026-10-05）。
    #   为什么要自报：这四项「内层读」的配置以前**根本传不进内层**（interop 丢环境变量），
    #   用户在任一侧设了都看不出有没有生效 —— 典型的「假逃生口」。现在外层走 argv 送进来
    #   （见 main / apply_inner_argv），这里把**实际生效的值**打出来，任何一次跑都能一眼核对。
    print(f'tts_indextts.py: 内层配置 —— engine={ENGINE} quant={QUANT} '
          f'device={DEVICE or "(auto)"} min_free_mib={VRAM_MIN_MIB}', flush=True)
    # ★ 不认的值**明确报错**，不静默回落：原来任何非 'v2_5' 的值都会静默掉进 else 分支当 v2 跑。
    if ENGINE not in ('v2_5', 'v2'):
        sys.exit(f"tts_indextts.py: INDEXTTS_ENGINE={ENGINE!r} is not a known inference path — "
                 f"use 'v2_5' (default, the official 2.5 path) or 'v2'.")
    # ★ 负的阈值会**静默**关掉显存预检（precheck_vram 里 `VRAM_MIN_MIB <= 0` 直接 return），
    #   与「想放行一点点」的意图正好相反 —— 想关就用 0，别用负数。
    if VRAM_MIN_MIB < 0:
        sys.exit(f'tts_indextts.py: INDEXTTS_MIN_FREE_MIB={VRAM_MIN_MIB} is negative — '
                 f'a negative value would silently disable the free-VRAM check. '
                 f'Use 0 to disable it on purpose, or a positive MiB floor.')
    sys.path.insert(0, APP)
    os.chdir(APP)                                        # CLI/推理代码靠相对路径找 checkpoints
    os.environ.setdefault('HF_HUB_CACHE', os.path.join(APP, 'checkpoints', 'hf_cache'))
    import numpy as np, soundfile as sf
    # ★ v2_5 只有 bf16 / fp32 两档：官方 infer_v2_5 的 use_bf16 是布尔，没有 fp16。
    #   实测：INDEXTTS_QUANT=fp16 配 ENGINE=v2_5 时，下面的 use_bf16=(QUANT != 'fp32') 会**静默**按
    #   bf16 跑 —— 用户以为用了 fp16，实际是 bf16，且全程一句话都不说。
    #   ★ 这里**不 fail**（用户可能就是想先跑起来，硬失败会把可跑的配置也挡掉），但必须**启动时出声**：
    #   说清 v2_5 只支持 bf16/fp32、fp16 已按 bf16 处理。放在加载模型之前 ⇒ 秒回，不用等模型。
    if ENGINE == 'v2_5' and QUANT not in ('bf16', 'fp32'):
        print(f'tts_indextts.py: INDEXTTS_QUANT={QUANT!r} is not supported by ENGINE=v2_5 '
              f'(v2_5 supports only bf16 / fp32) — treating it as bf16. '
              f'Set INDEXTTS_QUANT=bf16 or fp32 to make this explicit.', file=sys.stderr)
    # ★ v2 侧原来**完全不出声**：`use_fp16=(QUANT == 'fp16')` 于是 INDEXTTS_QUANT=bf16（或任何
    #   打错的值）都静默按 fp32 跑。照 v2_5 的先例，这里**出声**说明按什么跑（同样不 fail，
    #   理由见上一段：硬失败会把可跑的配置也挡掉）。
    if ENGINE == 'v2' and QUANT not in ('fp16', 'fp32'):
        print(f'tts_indextts.py: INDEXTTS_QUANT={QUANT!r} is not supported by ENGINE=v2 '
              f'(v2 supports only fp16 / fp32) — treating it as fp32. '
              f'Set INDEXTTS_QUANT=fp16 or fp32 to make this explicit.', file=sys.stderr)
    # ★ 显存预检（修 B）：必须在**真正 import / 构造模型之前**。不够就秒回报错，
    #   绝不让它走到「加载不进显存 → 无限挂起、零报错」那条路上去。
    precheck_vram()
    if ENGINE == 'v2_5':
        from indextts.infer_v2_5 import IndexTTS2
        tts = IndexTTS2(cfg_path='checkpoints/config.yaml', model_dir='checkpoints',
                        use_bf16=(QUANT != 'fp32'), use_qwen_emo=False,
                        use_cuda_kernel=False, device=(DEVICE or None))
    else:
        from indextts.infer_v2 import IndexTTS2
        tts = IndexTTS2(cfg_path='checkpoints/config.yaml', model_dir='checkpoints',
                        use_fp16=(QUANT == 'fp16'), use_qwen_emo=False,
                        use_cuda_kernel=False, device=(DEVICE or None))
    lines = json.load(open(lines_path, encoding='utf-8'))
    os.makedirs(out_dir, exist_ok=True)

    # ★ 产物清洗（2026-10-02 新增）。out_dir 是 demo 的 voices/，会被反复复用：
    #   换了内容/换了配音行之后，上一版留下的 <id>.wav 还躺在那里，dur.json 会把它一起算进去，
    #   而 events/字幕是按下标或按 id 找的 —— 实测踩到过：英文版遗留的 close.wav 混进中文成片，
    #   dur.json 里多出一条 "close": 5.383。**只清 wav，不碰别的**（lips.json/words.json 另有用途）。
    want_ids = [L['id'] for L in lines]
    stale = []
    for f in os.listdir(out_dir):
        if f.lower().endswith('.wav') and f[:-4] not in want_ids:
            try:
                os.remove(os.path.join(out_dir, f))
                stale.append(f)
            except OSError as e:
                print(f'warning: cannot remove stale {f}: {e}', file=sys.stderr)
    if stale:
        print(f'cleaned {len(stale)} stale wav(s) not in lines.json: {", ".join(sorted(stale))}',
              flush=True)

    # ★ 参考音预检（2026-10-02 新增）。依据见 REF_PEAK_WARN 处的注释：参考音太响 = 克隆输出削波，
    #   而削波不可逆。这里只**报**不改（不擅自改用户素材），每条音色只查一次。
    #   顺带报出 Index-TTS 实际会用的前 15s —— infer_v2_5 内部按 max_prompt_seconds=15 截断，
    #   长参考音（如播客片段）后 9s 会被无声丢弃，若前段含片头乐/人声不干净，音色就跑了。
    checked = {}
    for L in lines:
        ref = resolve_voice(L.get('voice'))
        if ref in checked:
            continue
        checked[ref] = True
        try:
            ry, rsr = sf.read(host_path(ref), always_2d=True)
            rmono = ry.mean(1) if ry.shape[1] > 1 else ry[:, 0]
            peak = float(np.abs(rmono).max()) if len(rmono) else 0.0
            rms = float(np.sqrt((rmono.astype('float64') ** 2).mean())) if len(rmono) else 0.0
            secs = len(rmono) / rsr
            print(f'reference {os.path.basename(ref)}: {secs:.2f}s peak {peak:.3f} rms {rms:.3f}'
                  + ('  ← 只有前 15s 会被用' if secs > 15 else ''), flush=True)
            if peak > REF_PEAK_WARN or rms > REF_RMS_WARN:
                print(f'warning: reference {os.path.basename(ref)} is loud '
                      f'(peak {peak:.3f} > {REF_PEAK_WARN} or rms {rms:.3f} > {REF_RMS_WARN}); '
                      f'cloned output may clip — lower it (e.g. ffmpeg -af volume=-15dB) first',
                      file=sys.stderr)
        except Exception as e:
            print(f'warning: cannot preflight {ref}: {type(e).__name__}: {e}', file=sys.stderr)

    dur = {}
    for L in lines:
        lid, text = L['id'], L['text']
        voice = resolve_voice(L.get('voice'))
        if not os.path.isfile(voice):
            sys.exit(f'tts_indextts.py: line {lid}: reference audio not found: {voice}')
        speed = float(L.get('speed', 1.0) or 1.0)
        wav = os.path.join(out_dir, lid + '.wav')
        try:
            if ENGINE == 'v2_5':
                lang = (L.get('lang') or 'cmn').split('-')[0]
                tts.infer(spk_audio_prompt=voice, text=text, lang=('ZH' if lang in ('cmn', 'zh') else lang.upper()),
                          output_path=wav, duration_factor=(1.0 / speed) if speed else 1.0, verbose=False)
            else:
                tts.infer(spk_audio_prompt=voice, text=text, output_path=wav, verbose=False)
        except Exception as e:
            sys.exit(f'tts_indextts.py: line {lid}: synthesis failed: {type(e).__name__}: {e}')
        # ★ sf.read 纳入逐行 try（2026-10-02）：原来它在 try 之外，读失败只抛裸 traceback，
        #   看不出是哪一行、什么原因。错误里带上 line id 与原始异常类型。
        try:
            y, sr = sf.read(wav, always_2d=True)
        except Exception as e:
            sys.exit(f'tts_indextts.py: line {lid}: cannot read synthesized wav: {type(e).__name__}: {e}')
        if y.shape[1] > 1:
            y = y.mean(1)
        else:
            y = y[:, 0]
        if ENGINE == 'v2' and abs(speed - 1.0) > 1e-6:      # v2 没有原生时长控制，退化成变调保持的时间伸缩
            import librosa
            y = librosa.effects.time_stretch(y.astype('float32'), rate=speed)
        # 去首尾静音（照抄 core/tts/tts.py 的规则）
        peak = float(np.abs(y).max()) if len(y) else 0.0
        # ★ peak == 0（整条静音）按**硬失败**处理（2026-10-02 修）：原来只打一句 warning 就继续，
        #   于是会照写一个 0 帧（或全零）的 wav、dur 记 0.0 —— 下游 mix.py / 字幕时间窗拿到 0 时长
        #   只会静默错位，不会报错，从日志里根本看不出是哪一条哑了。宁可在这里点名是哪条、非 0 退出。
        if peak == 0.0:
            sys.exit(f'tts_indextts.py: line {lid}: synthesized silence (peak == 0, {len(y)} frames) — '
                     f'refusing to write a silent/empty wav')
        nz = np.where(np.abs(y) > peak * .02)[0]
        y = y[max(0, nz[0] - int(.03 * sr)): nz[-1] + int(.08 * sr)]
        # Index-TTS 按参考音的电平出音，参考音录得响就会把输出顶到满刻度（它的保存路径是
        # clamp(32767*x) 后存 int16，削波不可逆）。这里只报不改，换一个安静的参考音即可。
        clip = int((np.abs(y) >= 0.999).sum())
        if len(y) and clip > 0.001 * len(y):
            print(f'warning: line {lid} clips: {clip} samples ({clip / len(y) * 100:.2f}%) hit full scale'
                  f' — pick a quieter reference voice', file=sys.stderr)
        # ★ sf.write 纳入逐行 try（2026-10-02）：原来它在 try 之外，写失败只抛裸 traceback。
        try:
            sf.write(wav, y, sr)
        except Exception as e:
            sys.exit(f'tts_indextts.py: line {lid}: cannot write wav: {type(e).__name__}: {e}')
        # ★ dur 必须等于**磁盘上那个文件**的时长，不能拿内存里的 len(y)/sr 顶替。
        #   实测踩到过：两者差约 12%（title 记 3.862，实际文件只有 3.121），
        #   而下游的 vo 事件、字幕窗口、整片时间轴全都按 dur.json 排 ——
        #   结果是字幕比配音拖后 0.5~0.9 秒、语音又常常早于字幕结束。
        #   回读一遍是唯一能保证「记的就是写下去的」的做法，代价可忽略。
        info = sf.info(wav)
        dur[lid] = round(info.frames / info.samplerate, 3)
        print(lid, dur[lid], text, flush=True)
    # ★ 一一对应断言（2026-10-02 新增）。dur.json 是下游 events/字幕排时间窗的唯一依据，
    #   一旦它多一条（旧产物残留）或少一条（某条静默跳过），下游会静默错位而不是报错。
    #   宁可在这里硬失败，也不要出一个「字幕对不上配音」的片子。
    if set(dur) != set(want_ids):
        sys.exit(f'tts_indextts.py: dur.json mismatch — lines={len(want_ids)} dur={len(dur)}; '
                 f'missing={sorted(set(want_ids) - set(dur))} extra={sorted(set(dur) - set(want_ids))}')
    json.dump(dur, open(os.path.join(out_dir, 'dur.json'), 'w', encoding='utf-8'), indent=1)


# ── 外层：校验 + 路径转换 + 用 Windows venv python 重新执行本文件 ─────────────────
def host_path(p):
    """把 Windows 路径换成本宿主能直接用的路径。

    ★ 为什么需要：本脚本既可能在 Windows 上跑，也可能**从 WSL 里**跑 —— 编排器（lemo-make.mjs）
      的音频链路就在 WSL，而它调的就是这个脚本。WSL 里 `D:/...` 既不是合法路径、也不能直接 exec，
      要用 `/mnt/<盘符>/...` 才能做存在性检查、并借 WSL interop 启动那个 Windows python。
    ★ 但**传给内层（Windows python）的参数仍然必须是 Windows 路径** —— 它认 `D:/` 不认 `/mnt/d/`。
      所以这个函数只用于「本宿主自己去碰」的那几处（存在性检查、可执行文件路径），不用于参数。
    """
    if os.name == 'nt':
        return p
    m = re.match(r'^([A-Za-z]):[\\/](.*)$', p)
    return '/mnt/%s/%s' % (m.group(1).lower(), m.group(2)) if m else p


def list_voices():
    """把「这个工程认得的所有音色」导成 JSON，给控制台面板的音色选择用。

    ★ 为什么由这个脚本导出、而不是在 Node 侧另写一份清单：
      别名的定义就在本文件里（VOICE_ALIASES / LIB_ALIASES），另写一份必然漂移。
      这里只需要**路径与文件头**，不加载模型，所以可以用任意 python 跑（不必是 Index-TTS 的 venv）。
    每条给出：name（写进内容文件的名字）/ kind / file / exists / secs / peak / rms。
    """
    import wave
    def stat(p):
        hp = host_path(p)
        if not os.path.isfile(hp):
            return dict(exists=False, secs=None, peak=None, rms=None)
        # ★ 先试标准库 wave；它对 WAVE_FORMAT_IEEE_FLOAT（format 3）会直接抛
        #   `unknown format: 3` —— 实测官方 voice_01/02/11 就是 32bit float，而 Index-TTS
        #   走 librosa.load，**这三个文件本来就能当参考音用**。若只报个 error，面板会把
        #   「格式特殊」显示成「坏了」，是误导。所以失败时退回手工解析 RIFF 头拿时长。
        try:
            w = wave.open(hp)
            n, sr, sw, ch = w.getnframes(), w.getframerate(), w.getsampwidth(), w.getnchannels()
            raw = w.readframes(n) if sw in (2, 3) else None
            w.close()
            secs = round(n / sr, 3) if sr else None
            peak = rms = None
            if raw and n:
                if sw == 2:
                    import array
                    a = array.array('h'); a.frombytes(raw); scale = 32768.0
                else:                                   # 24bit 打包成 3 字节小端
                    b = raw
                    a = [int.from_bytes(b[i:i + 3], 'little', signed=True) for i in range(0, len(b) - 2, 3)]
                    scale = 8388608.0
                if ch > 1:                              # 多声道按帧取均值
                    a = a[::ch] if sw == 3 else array.array('h', [sum(a[i:i + ch]) // ch for i in range(0, len(a), ch)])
                if len(a):
                    peak = round(max(abs(x) for x in a) / scale, 4)
                    rms = round((sum(float(x) * x for x in a) / len(a)) ** 0.5 / scale, 4)
            return dict(exists=True, secs=secs, peak=peak, rms=rms, fmt=f'pcm{sw * 8}')
        except Exception:
            return _riff_stat(hp)

    def _riff_stat(hp):
        """手工解析 RIFF（wave 读不了时用）。除了时长，还尽量解出电平 —— 32bit float 是
        官方 voice_01/02/11 的格式，面板上给不出电平就等于没验。"""
        try:
            with open(hp, 'rb') as f:
                if f.read(4) != b'RIFF':
                    return dict(exists=True, secs=None, peak=None, rms=None, error='不是 RIFF 文件')
                f.read(4)
                if f.read(4) != b'WAVE':
                    return dict(exists=True, secs=None, peak=None, rms=None, error='不是 WAVE 文件')
                ch = sr = bits = fmt = None
                while True:
                    hdr = f.read(8)
                    if len(hdr) < 8:
                        return dict(exists=True, secs=None, peak=None, rms=None, error='RIFF 里没有 data 块')
                    cid, sz = hdr[:4], int.from_bytes(hdr[4:8], 'little')
                    if cid == b'fmt ':
                        b = f.read(sz)
                        fmt = int.from_bytes(b[0:2], 'little')
                        ch = int.from_bytes(b[2:4], 'little')
                        sr = int.from_bytes(b[4:8], 'little')
                        bits = int.from_bytes(b[14:16], 'little')
                    elif cid == b'data':
                        raw = f.read(min(sz, 64 * 1024 * 1024))   # 最多读 64MB，够算电平
                        secs = round(sz / (sr * ch * bits / 8), 3) if (sr and ch and bits) else None
                        peak = rms = None
                        try:
                            import array, struct
                            if fmt == 3 and bits == 32:               # IEEE float
                                a = array.array('f'); a.frombytes(raw[:len(raw) // 4 * 4])
                                scale = 1.0
                            elif bits == 16:
                                a = array.array('h'); a.frombytes(raw[:len(raw) // 2 * 2])
                                scale = 32768.0
                            elif bits == 24:
                                a = [int.from_bytes(raw[i:i + 3], 'little', signed=True)
                                     for i in range(0, len(raw) - 2, 3)]
                                scale = 8388608.0
                            else:
                                a = []; scale = 1.0
                            if len(a):
                                peak = round(max(abs(x) for x in a) / scale, 4)
                                rms = round((sum(float(x) * x for x in a) / len(a)) ** 0.5 / scale, 4)
                        except Exception:
                            pass
                        return dict(exists=True, secs=secs, peak=peak, rms=rms, fmt=f'fmt{fmt}/pcm{bits}')
                    else:
                        f.seek(sz + (sz & 1), 1)
        except Exception as e:
            return dict(exists=True, secs=None, peak=None, rms=None, error=f'{type(e).__name__}: {e}')

    items = []
    for name, fn in sorted(VOICE_ALIASES.items()):
        p = os.path.join(REF_DIR, fn)
        items.append(dict(name=name, kind='alias', label=fn, file=p, **stat(p)))
    for name, fn in sorted(LIB_ALIASES.items()):
        p = os.path.join(LIB_DIR, fn)
        items.append(dict(name=name, kind='library-alias', label=fn, file=p, **stat(p)))
    for n in available_refs():
        p = os.path.join(REF_DIR, n + '.wav')
        items.append(dict(name=n, kind='official', label=n + '.wav', file=p, **stat(p)))
    for n in available_lib():
        if n in [os.path.splitext(v)[0] for v in LIB_ALIASES.values()]:
            continue                                # 已被别名覆盖，不重复列
        p = os.path.join(LIB_DIR, n + '.wav')
        items.append(dict(name=n, kind='library', label=n + '.wav', file=p, **stat(p)))
    print(json.dumps(dict(
        default=DEFAULT_VOICE, voices=items,
        refDir=REF_DIR, libDir=LIB_DIR,
        refDirOk=os.path.isdir(host_path(REF_DIR)), libDirOk=os.path.isdir(host_path(LIB_DIR)),
        peakWarn=REF_PEAK_WARN, rmsWarn=REF_RMS_WARN,
    ), ensure_ascii=False, indent=1))


# ── 全局串行锁 ────────────────────────────────────────────────────────────────
# ★ 为什么必须有（2026-10-02 实测）：Index-TTS 跑在一张 8GB 显存的卡上，**绝不能并发**。
#   实测同时跑 4~5 个实例时，同一条 30 字的合成从 **6 秒**变成 **4~7 分钟**
#   （单条 s2mel_time 334s、RTF 62~75），并且直接导致一次 11 句的任务超时失败。
#   锁文件放在 HOME 下、由**任何调用方共用**（编排器 / 控制台 / 手工跑都走这里），
#   所以串行是全局的，不需要每个上层各自再排一个队。
#   放在外层（不是内层）：外层启动内层后会一直等它结束，所以锁住外层就锁住了整段推理。
LOCK_PATH    = os.environ.get('INDEXTTS_LOCK', os.path.join(HOME, '.indextts.lock'))
# ★ 外层可能跑在 WSL：锁文件必须用**本宿主**的路径形式去开，否则 Linux 会把 `D:/x` 当相对路径，
#   锁就落到 cwd 下一个叫 `D:` 的文件里，等于没锁（这个项目在跨宿主路径上已经栽过好几次）。
LOCK_LOCAL   = host_path(LOCK_PATH)
LOCK_TIMEOUT = int(os.environ.get('INDEXTTS_LOCK_TIMEOUT', '7200'))   # 等锁上限（秒）
LOCK_STALE   = int(os.environ.get('INDEXTTS_LOCK_STALE', '21600'))    # 锁超过这么久视为残留（秒）


def _pid_alive(pid):
    """同宿主内判断 pid 是否还活着。判不出来一律返回 True（**宁可多等，也不抢别人的锁**）。"""
    if not pid or pid <= 0:
        return True
    try:
        if os.name == 'nt':
            import ctypes
            h = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))   # QUERY_LIMITED_INFORMATION
            if not h:
                return False
            ctypes.windll.kernel32.CloseHandle(h)
            return True
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except Exception:
        return True


def _host_kind():
    return 'nt' if os.name == 'nt' else 'posix'


def acquire_lock():
    """等到拿到锁为止。锁文件内容是 `<宿主>:<pid>`（如 `posix:437`）。

    ★ 为什么要带宿主标签（2026-10-02 实测踩到）：Windows 与 WSL 是**两套 pid 命名空间**。
      锁里若只写裸 pid，WSL 侧的等待者去 `os.kill(<Windows pid>, 0)` 必然查不到那个进程，
      于是把**正在被 Windows 侧持有的锁**误判成残留、直接抢走 —— 串行就失效了。
      所以：宿主标签与自己一致才做 pid 存活检查；不一致时**只能靠锁龄**判残留。
    """
    import time
    me = f'{_host_kind()}:{os.getpid()}'
    t0, waited = time.time(), False
    while True:
        try:
            fd = os.open(LOCK_LOCAL, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, me.encode())
            os.close(fd)
            if waited:
                print('tts_indextts.py: 拿到配音锁，开始合成', flush=True)
            return
        except FileExistsError:
            raw, age = '', 0.0
            try:
                raw = (open(LOCK_LOCAL).read().strip() or '')
                age = time.time() - os.path.getmtime(LOCK_LOCAL)
            except Exception:
                pass
            kind, _, pid_s = raw.partition(':')
            if not pid_s:                      # 兼容旧格式（裸 pid）：宿主未知 ⇒ 只按锁龄判
                kind, pid_s = '', raw
            try:
                owner = int(pid_s or '0')
            except ValueError:
                owner = 0
            same_host = (kind == '' or kind == _host_kind())   # 裸 pid（旧格式）= 宿主未知，按同宿主尽力判
            # ★ 不能等自己（同一进程重复 acquire）
            if same_host and owner == os.getpid():
                return
            # 只有「同宿主且 pid 明确已死」或「锁老得离谱」才敢抢；跨宿主时只认锁龄
            if (same_host and not _pid_alive(owner)) or age > LOCK_STALE:
                try:
                    os.remove(LOCK_LOCAL)
                    print(f'tts_indextts.py: 清掉残留的配音锁（{raw or "空"}，{age / 60:.0f} 分钟前）', flush=True)
                    continue
                except OSError:
                    pass
            if not waited:
                print(f'tts_indextts.py: 等待另一个配音任务完成（{raw or "未知"}）—— '
                      f'Index-TTS 在 8GB 显存上不能并发，并发会把单句从几秒拖到几分钟', flush=True)
                waited = True
            if time.time() - t0 > LOCK_TIMEOUT:
                sys.exit(f'tts_indextts.py: 等了 {LOCK_TIMEOUT}s 还没拿到配音锁（持有者 {raw or "未知"}）。\n'
                         f'  要么另一个任务卡住了，要么它是残留锁 —— 确认后删掉 {LOCK_PATH} 即可。')
            time.sleep(3)


def release_lock():
    try:
        raw = (open(LOCK_LOCAL).read().strip() or '')
        if raw == f'{_host_kind()}:{os.getpid()}' or raw == str(os.getpid()):
            os.remove(LOCK_LOCAL)
    except Exception:
        pass


def _count_wavs(d):
    """数 out_dir 里有多少个 wav。目录还不存在 / 读不了 → 0（不算异常）。"""
    try:
        return sum(1 for f in os.listdir(d) if f.lower().endswith('.wav'))
    except OSError:
        return 0


def _fmt_secs(s):
    return f'{s:.0f}s' if s < 90 else f'{s / 60:.1f}min'


def run_with_watchdog(cmd, env, out_dir, timeout, stall):
    """启动内层（Windows venv python）并在旁边盯着它：**活着但毫无进展**就杀掉、报错、非 0 退出。

    ★ 判据（双条件，缺一不可）—— 内层进程**还活着**，但
        (a) 超过 stall 秒**没有新的 stdout 输出**，且
        (b) 这段时间里 out_dir **没有新增 wav**
      两条同时成立才判定卡住。
    ★ 为什么必须双条件、阈值为什么不能小（依据 = 两次真实事故 + 正常耗时）：
      · 只看「时间」会误杀正常任务：模型**首次加载**要 1~2 分钟，这期间内层**一句都不打**；
        单句合成几十秒；长文案可十几分钟。所以「安静了」单独不能说明任何问题。
      · 只看「没有新 wav」也会误杀：加载模型期间本来就不会有 wav。
      · 只有「进程活着 + 输出停了 + wav 停了」同时成立，才是真的卡住 —— 只要它还在打日志、
        或还在往 out_dir 落 wav，就说明它在干活，看门狗绝不打扰。
      · 阈值 300s：是最慢的正常静默段（加载 ~120s）的 2.5 倍，留足余量；
        又远小于 LOCK_TIMEOUT(7200s) —— 卡住的持有者最多堵住别人 5 分钟，而不是 2 小时。
      · 两次事故都精确命中本判据：
        ① 显存被 LM Studio 占满 → 模型加载不进、**无限挂起且零报错**（无输出、无 wav、进程活着）；
        ② WSL→Windows 互操作层偶发卡住 → CPU time 全 0、Windows 侧连 python.exe 都没起来、
           显存 0、_tts/ 空，但**进程持有锁**，把所有后来者堵到 2 小时超时。
    ★ 输出转发：内层 stdout 用**字节**逐行读出、原样写回本进程 stdout —— 不做编码转换，
      避免 Windows 内层（cp936）的字节被按 utf-8 解码成乱码；同时把它当心跳（有新行 = 有进展）。
      stderr 不接管（内层直接继承），保持与改造前完全一致。
    """
    import threading, time
    t0 = time.time()
    # out_dir 是**本宿主**的路径（main 里 as_local 过），但可能是 Windows 形式（外层跑在 WSL 时
    # 用户直接传了 D:/...）—— 数 wav 要用本宿主能读的形式，所以过一遍 host_path。
    local_out = host_path(out_dir)
    # stdin 已由调用方钉成 DEVNULL（见 main 里的说明），这里不重复设置以免改坏那条免疫。
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stdin=subprocess.DEVNULL)
    hb = {'last_out': t0, 'last_line': b''}          # hb = heartbeat，由读线程写、主线程读

    def _pump():
        out = proc.stdout
        try:
            for line in out:                          # 按行迭代：内层 -u 无缓冲，行到即见
                hb['last_out'] = time.time()
                hb['last_line'] = line
                try:
                    sys.stdout.buffer.write(line)
                    sys.stdout.buffer.flush()
                except Exception:
                    sys.stdout.write(line.decode('utf-8', 'replace'))
                    sys.stdout.flush()
        except Exception:
            pass
        finally:
            try:
                out.close()
            except Exception:
                pass

    th = threading.Thread(target=_pump, daemon=True)
    th.start()

    def _last_line_text():
        b = hb['last_line'] or b''
        for enc in ('utf-8', 'gbk'):                  # 内层在 Windows 下可能按 cp936 输出
            try:
                return b.decode(enc).strip()[:400]
            except Exception:
                continue
        return repr(b[:400])

    seen_wavs, last_wav = _count_wavs(local_out), t0
    verdict = None
    while True:
        try:
            proc.wait(timeout=5)                      # 5s 一个心跳周期
            break
        except subprocess.TimeoutExpired:
            pass
        now = time.time()
        n = _count_wavs(local_out)
        if n != seen_wavs:                            # 落了新 wav = 有进展，重置计时
            seen_wavs, last_wav = n, now
        idle = now - max(hb['last_out'], last_wav, t0)
        if stall > 0 and idle > stall:
            verdict = ('stall', idle)
            break
        if now - t0 > timeout:
            verdict = ('timeout', now - t0)
            break

    if verdict is None:                               # 正常结束：原样把返回码交回 main
        try:
            th.join(timeout=5)                        # 等读线程把剩余输出吐干净
        except Exception:
            pass
        return proc.returncode

    kind, secs = verdict
    # ★ 先杀内层再退出：卡住的持有者必须消失。即使我们释放了锁，它一旦「醒过来」还会继续
    #   写 _tts/、继续占显存，和后来者抢 —— 那样自愈就是假的。
    try:
        proc.kill()
    except Exception:
        pass
    try:
        proc.wait(timeout=10)
    except Exception:
        pass
    try:
        th.join(timeout=3)
    except Exception:
        pass

    detail = (f'  卡住时长:        {_fmt_secs(secs)}（阈值 {stall}s，'
              f'INDEXTTS_STALL_TIMEOUT 可调，0=关闭）\n'
              f'  最后一条内层输出: {_last_line_text() or "(内层从未输出过任何东西)"}\n'
              f'  {out_dir} 里的 wav: {_count_wavs(local_out)} 个\n')
    if kind == 'timeout':
        sys.exit(f'tts_indextts.py: the Index-TTS worker did not finish within {timeout}s '
                 f'(INDEXTTS_TIMEOUT).\n' + detail)
    sys.exit(
        f'tts_indextts.py: 配音内层卡住了 —— 已自动中断并释放配音锁，请重试。\n'
        f'  {_fmt_secs(secs)} 内既没有新的内层输出、{out_dir} 也没有新增 wav，'
        f'但内层进程还活着 —— 典型的「持有锁却毫无进展」。\n'
        f'  最常见的原因是 WSL→Windows 互操作层偶发卡住\n'
        f'    （CPU time 全 0、Windows 侧连 python.exe 都没起来、显存没占用、_tts/ 空），\n'
        f'    其次是加载模型时显存被占满而无限挂起（那种情况下面会有更具体的提示）。\n'
        + detail +
        f'  处理: 锁已释放，直接重跑即可。若反复出现，先用 `nvidia-smi` 看显存、'
        f'        在 LM Studio 里卸载模型后再跑。'
    )


def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--list-voices':
        return list_voices()
    if len(sys.argv) < 3 or sys.argv[1] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0 if len(sys.argv) > 1 and sys.argv[1] in ('-h', '--help') else 2)
    # ★ 不要对 Windows 路径调 os.path.abspath：在 Linux（WSL）上它会把 `D:/x` 当成**相对路径**，
    #   拼成 `/home/lemo/lemo-opuscar/D:/x`，再传给内层的 Windows python 就变成
    #   `\\wsl.localhost\...\D:\x` → makedirs 报 WinError 161（实测踩到过）。
    #   只在「本来就是本宿主路径」时才做 abspath。
    def as_local(p):
        return p if re.match(r'^[A-Za-z]:[\\/]', p) else os.path.abspath(p)
    lines_path, out_dir = as_local(sys.argv[1]), as_local(sys.argv[2])
    if not os.path.isfile(lines_path):
        sys.exit(f'tts_indextts.py: lines file not found: {lines_path}')
    if not os.path.isfile(host_path(PYTHON)):
        sys.exit(f'tts_indextts.py: the Index-TTS venv python is not at {PYTHON}.\n'
                 f'  set INDEXTTS_HOME / INDEXTTS_PYTHON to your Index-TTS install.')
    if not os.path.isdir(host_path(APP)):
        sys.exit(f'tts_indextts.py: the Index-TTS app dir is not at {APP} (set INDEXTTS_APP).')
    lines = json.load(open(lines_path, encoding='utf-8'))
    # ★ 前置校验每条都有 id / text（2026-10-02）：原来直接 L['id'] / L['text'] 下标取值，
    #   缺字段时只抛裸 KeyError('text')，看不出是第几条、缺哪个字段。这里点名后退出。
    for i, L in enumerate(lines):
        if not isinstance(L, dict):
            sys.exit(f'tts_indextts.py: lines.json[{i}] is not an object (expected keys "id" and "text")')
        for k in ('id', 'text'):
            if k not in L:
                sys.exit(f'tts_indextts.py: lines.json[{i}] is missing required field "{k}"')
    wrong = [L['id'] for L in lines if str(L.get('lang', 'cmn')).lower().startswith('en') and CJK.search(L['text'])]
    if wrong:
        sys.exit(f"tts_indextts.py: line(s) {', '.join(map(str, wrong))} contain Chinese text but lang is English.\n"
                 f'  Index-TTS clones the reference audio, it does not need a lang per line for zh; drop the field or set "lang": "cmn".')
    for L in lines:
        v = resolve_voice(L.get('voice'))
        if not os.path.isfile(host_path(v)):
            sys.exit(f"tts_indextts.py: line {L['id']}: reference audio not found: {v}")
    env = dict(os.environ, _LEMO_INDEXTTS_INNER='1')
    # ★ 推理全程持锁（见文件上方「全局串行锁」）。finally 里放，异常/超时/看门狗杀进程也一定释放。
    acquire_lock()
    try:
        # ★ `--inner` 必须走**命令行参数**，不能只靠 env=... 里的 _LEMO_INDEXTTS_INNER：
        #   WSL→Windows interop 不传环境变量（见文件末尾 __main__ 处的说明），只传 argv。
        # ★ 同理，四项「内层读」的配置（INNER_OPTS）也必须走 argv：上面那个 env= 传的是
        #   `dict(os.environ)` 的完整副本，内层**一个都读不到**（2026-10-05 实测）。
        #   这里把外层环境里的值翻译成 `--engine=… --quant=… --device=… --min-free-mib=…`。
        #   ★ 只在**外层确实设了**时才带这个参数：不设就完全不传，内层保持自己的默认值 ——
        #     这样「在 Windows 侧用系统环境变量设的值」也仍然有效（实测能进内层），两条路都不丢。
        inner_cmd = [host_path(PYTHON), '-u', win_path(os.path.abspath(__file__)), '--inner',
                     win_path(lines_path), win_path(out_dir)]
        for _var, _flag, _name in INNER_OPTS:
            if os.environ.get(_var) is not None:
                inner_cmd.append(f'{_flag}={os.environ[_var]}')
        # ★ 这里用 run_with_watchdog 而不是 subprocess.run：内层「活着但毫无进展」时（两次真实
        #   事故的共同点：持有者卡住 = 所有人等到 2 小时超时）要能自己中断并释放锁。
        #   内层 stdin 仍由它显式钉成 /dev/null —— 见下面那段说明，不能省。
        rc = run_with_watchdog(inner_cmd, env, out_dir, TIMEOUT, STALL_TIMEOUT)
    finally:
        release_lock()
    sys.exit(rc)


if __name__ == '__main__':
    # ★ 2026-10-02 修「内层认不出自己 → 抢自己父亲的锁 → 永久静默挂死」：
    #   原来只靠环境变量 `_LEMO_INDEXTTS_INNER` 分辨内外层。但 **WSL→Windows 的 interop
    #   不把 WSL 侧的环境变量传给 Windows 进程**（实测：WSL 里 `export FOO=bar` 后，
    #   那个 Windows python 的 os.environ 里**根本没有 FOO**，187 个变量全是 Windows 自己的）。
    #   于是内层（Windows python）认不出自己，又走了一遍 main() → 又去抢**外层刚拿到的那把锁**
    #   → 内层永远等锁、外层永远等内层，双方都零 CPU、零显存、零输出，**静默挂到 LOCK_TIMEOUT（2 小时）**。
    #   实测复现：`INDEXTTS_LOCK=/tmp/x.lock` 跑外层，内层照样去打**默认**锁文件
    #   （打印「等待另一个配音任务完成（posix:<外层pid>）」）—— 这就是那条挂死的路径。
    #   ★ 命令行参数**不受**这个限制（内层拿到的 argv 一直是对的），所以内层改由 `--inner` 标识；
    #     环境变量那条分支保留，兼容直接在 Windows 上跑的场景（那里 env 是原生传递的）。
    _inner = (len(sys.argv) > 3 and sys.argv[1] == '--inner') or os.environ.get('_LEMO_INDEXTTS_INNER') == '1'
    if _inner:
        # ★ 内层读的配置由外层翻译成 argv 带过来（见 main 里的 INNER_OPTS）—— 参数一律接在
        #   lines / out_dir **之后**，所以 sys.argv[2] / sys.argv[3] 的位置不受影响。
        apply_inner_argv(sys.argv[4:])
        run_inner(sys.argv[2], sys.argv[3])
    else:
        main()
