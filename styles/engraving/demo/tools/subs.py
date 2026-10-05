# subtitles from the film's voice events (same rule as film.js drawSubs): on 0.1 s before the line, off 0.6 s after it
import json, os, sys
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
content = sys.argv[1] if len(sys.argv) > 1 else 'content.json'
W = os.environ.get('ENG_WORK') or D
_E = json.load(open(os.path.join(W, 'events.json')))
E = _E['ev']; C = json.load(open(os.path.join(D, content)))
DUR = _E['dur']                       # ★ 片长：字幕窗的上界必须被它夹住
text = {l['id']: l['text'] for l in C['voice']['lines']}
vo = [e for e in E if e['type'] == 'vo']
# ★ 末条字幕原来把上界写成 1e9（等于不夹），于是 t1 = vo.t + dur + 0.6 会**越过片长**：
#   实测末条窗 41.256–44.679，而片长 44.458 —— 多出的 0.22s 落在画面之外，
#   结果是末条字幕的淡出（fade 用 [t1-0.2, t1]）被切掉，在片尾硬消失。
#   夹到片长即可（这条对 SRT 与烧入画面的字幕同时生效，两者共用 subs.json）。
def t1_of(i, v):
    hi = vo[i + 1]['t'] - 0.2 if i + 1 < len(vo) else DUR
    return round(min(v['t'] + v['dur'] + 0.6, hi), 3)
cues = [dict(t0=round(v['t'] - 0.1, 3), t1=t1_of(i, v), text=text[v['id']]) for i, v in enumerate(vo)]
os.makedirs(os.path.join(D, 'out'), exist_ok=True)
json.dump(cues, open(os.path.join(W if W != D else os.path.join(D, 'out'), 'subs.json'), 'w'), indent=1)
for c in cues: print(c)
