# 手工入口（DEMO.md:134 声明：`.venv/bin/python $D/words.py L01 L02 … L25` → vo/words.json）。
# ★ 已被 core/tts/asr_check.py 取代 —— 若要重跑请优先用：core/tts/asr_check.py --lang zh --model medium
#   理由（本份 vs core 版）：
#     · 离线守卫：core 版支持 HF_HUB_OFFLINE=1 / LEMO_ASR_OFFLINE=auto|1|0（asr_check.py:14-18），本份无；
#     · 退出码：core 版有 0/1/2（asr_check.py:18；模型加载失败即退出 2），本份无；
#     · 模型可配：core 版 --model / WHISPER_MODEL（asr_check.py:10），本份硬编码 WhisperModel('medium')；
#     · core 版同时做逐行文本比对（OK/DIFF），本份只转录。
#   保留原因：DEMO.md:134 明写要跑它（它确实写 vo/words.json），删了会让 Build notes 失真。
import json, sys
import os as _os; _os.chdir(_os.path.dirname(_os.path.abspath(__file__)))   # 路径相对 demo/
from faster_whisper import WhisperModel
m = WhisperModel('medium', device='cpu', compute_type='int8')
out = {}
for lid in sys.argv[1:]:
    segs, _ = m.transcribe(f"vo/{lid}.wav", language='zh', word_timestamps=True, initial_prompt='以下是普通话的句子。')
    out[lid] = [(w.word, round(w.start, 2), round(w.end, 2)) for s in segs for w in s.words]
    print(lid, out[lid])
json.dump(out, open('vo/words.json', 'w'), ensure_ascii=False, indent=0)
