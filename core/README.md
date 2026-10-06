# core/: the shared production tools

Command reference for `core/` and `tools/`. How the pieces fit together is in [`TECHNIQUE.md`](../TECHNIQUE.md). Run commands from the library root (`$LIB` in skill mode); Python is the library's `.venv/bin/python`. `<demo>` is any folder with an `index.html`.

## Install

| Command | What it does |
|---|---|
| `sh plugin/skills/lemo-opuscar/scripts/setup.sh` | find, clone or update the library; prints `LIB=<path>` |
| `… setup.sh deps` | core tier: npm packages, headless browser, `.venv` from `requirements.txt` |
| `… setup.sh deps voice` | adds `requirements-voice.txt` (kokoro-onnx, edge-tts, faster-whisper) and the Kokoro model |
| `… setup.sh deps music` | adds `requirements-music.txt` (numba, for `pluck.py`; `sampler.py` needs only the core) |
| `… setup.sh demo <slug>` | adds one style's demo source and poster (to read, not to render) |
| `sh tools/fetch.sh voice` \| `hdri` \| `instruments <lib>` \| `instruments all` | Kokoro model · HDRIs · a sample library (`freepats`, `karoryfer`, `salamander`, `vcsl`, `vsco2ce`) |

Sizes are in TECHNIQUE.md §1.

## The page contract

| Global | Required | Meaning |
|---|---|---|
| `window.READY = true` | yes | set once fonts and images are loaded |
| `window.render(t)` | yes | draw the frame at second `t`; deterministic |
| `window.DUR` | video, events, readcheck | film length in seconds |
| `window.EV = [{t, type, …}]` | no | sound and cue events, exported by `events.mjs` |
| `window.TEXTS(t)` | readcheck | `[{id, text, x0, y0, x1, y1}]`: every on-screen text visible at `t`, with its box in pixels. Report an element's **full** text from its first visible frame (a typewriter that reports only the typed letters fails the check) |

The viewport is 1920×1080 at device scale 1, or `--size WxH`. `--q 'k=v&…'` reaches the page as `location.search`. A page error, or an HTTP error on a script, module or the page, stops the tool (exit 1). Other missing files (fetch, images, fonts) print `optional file missing: <URL>` and the tool carries on. The tools wait up to 180 s for `window.READY`.

## Render

| Command | What it does |
|---|---|
| `node core/render/still.mjs <demo> <t> [<t> …] [--range a:b:step] [--prefix t_] [--out dir]` | review stills as JPEGs (default `<demo>/stills/t_<t>.jpg`) |
| `node core/render/video.mjs <demo> [--fps 24] [--workers 3] [--out <demo>/out/video.mp4]` | every frame to a video; up to 6 workers for a single render. Each parallel version needs its own `--out` |
| `node core/render/events.mjs <demo> [--out <file>]` | export `{dur, ev}` to `<demo>/events.json` |
| `node core/render/readcheck.mjs <demo> [--step 0.04] [--latin-cps 15] [--cjk-cps 4.5] [--pad 1.5] [--min 1.5]` | reading-time check (below) |
| `.venv/bin/python core/render/sheet.py out.jpg img… [--cols 4] [--w 480]` | contact sheet |
| `.venv/bin/python core/render/srt.py cues.json out.srt` | subtitles from `[{t0, t1, text}]` |
| `sh core/render/mux.sh video.mp4 mix.wav out.mp4 [fps=24] [grain=2]` | mux and master (below) |

All four page tools take `--size WxH` (default `1920x1080`, even numbers) and `--q 'k=v'`. The ratio list and the ratio→pixel arithmetic live in `core/render/size.mjs` (`RATIOS` / `DEFAULT_RATIO` / `resolveSize`); the orchestrator's `--ratio` and the console read them from there. **The low-level default stays 1920×1080** — the **35** demos that ship a `build.sh` (8 of the 43 styles ship none) call these tools without `--size` and compose at 1920×1080, so a 9:16 default would break all 35. Count it with `ls styles/*/demo/build.sh | wc -l` (35) and confirm none passes a size: `grep -l -- --size styles/*/demo/build.sh` (empty). The publishing flow (orchestrator / console) defaults to 9:16 and passes the size down explicitly.

**readcheck** asks the page for `window.TEXTS(t)` at every step. Each text must stay fully in frame, unchanged, for at least CJK characters ÷ 4.5 + other non-space characters ÷ 15 + 1.5 s, and never less than `--min`. A new `text` under the same `id` starts a new piece. Subtitles are checked by their `.srt`, not here.

**mux** runs a two-pass `loudnorm` to −14 LUFS / true peak −1.2 dB, adds film grain (`grain` 0 = none) and prints the measured loudness. Silent audio is left at its level with a warning; short audio is padded, long audio cut at the picture's end; missing, damaged or truncated audio is refused. It never leaves a partial file.

## Audio

| Command | What it does |
|---|---|
| `.venv/bin/python core/tts/tts.py lines.json out_dir` | Kokoro, offline. `lines.json` = `[{id, text, voice?, speed?, lang?}]` (defaults `af_bella`, `0.92`, `en-us`; Chinese: `"lang": "cmn"`, a `zf_*`/`zm_*` voice). Writes `<id>.wav` (24 kHz, trimmed) and `dur.json`. Needs a library path under 160 bytes (espeak-ng); it checks |
| `python3 core/tts/tts_indextts.py lines.json out_dir` | local **Index-TTS 2.5** portable app (Windows), offline; same `lines.json` and same outputs as `tts.py` (`<id>.wav` 22.05 kHz mono 16-bit, trimmed, + `dur.json`). Zero-shot clone: `voice` is a **reference clip**, not a voice name — an alias (`zh_curator`, `zh_curator_alt`), a `voice_NN` clip that actually exists in the dir (a missing one is refused, and the error lists the real names — the shipped dir has `voice_01`–`09`, `11`, `12`, no `voice_10`), or a `.wav` path under `INDEXTTS_REF_DIR`; `speed` maps to `duration_factor = 1/speed`. The script **re-executes itself** under the app's own venv (`--inner` argv) and synthesises every line in **one process** (the **model file is 3.2 GB**, but the **VRAM it needs is larger** and grows with the reference clip's length — the free-VRAM floor lives in `core/tts/tts_indextts.py`; never one call per line). Config: `INDEXTTS_HOME` / `INDEXTTS_APP` / `INDEXTTS_PYTHON` / `INDEXTTS_REF_DIR` / `INDEXTTS_VOICE_LIB` / `INDEXTTS_ENGINE` / `INDEXTTS_QUANT` / `INDEXTTS_DEVICE` / `INDEXTTS_TIMEOUT` / `INDEXTTS_STALL_TIMEOUT` / `INDEXTTS_MIN_FREE_MIB` / `INDEXTTS_LOCK` / `INDEXTTS_LOCK_TIMEOUT` / `INDEXTTS_LOCK_STALE` (**which process reads which — see Environment variables**). Picked by the content file's `voice.engine`, not by a flag |
| `.venv/bin/python core/tts/tts_zh.py lines.json out_dir [--voice zh-CN-XiaoxiaoNeural] [--rate +0%] [--pitch +0Hz]` | edge-tts (Microsoft), online; same outputs as `tts.py`. Per line: `voice`, `rate`, `pitch`, `say` (what is spoken when it differs from `text`). Caches in `out_dir/.cache/`. Voices: `.venv/bin/python -m edge_tts --list-voices` |
| `.venv/bin/python core/tts/asr_check.py lines.json voices_dir [--lang en\|zh\|auto] [--threshold 0.92] [--model base]` | speech-to-text check of every `<id>.wav`; writes `words.json` (word timestamps). English must match word for word (0–999 count the same as their words); Chinese, Japanese, Korean compare by character similarity ≥ `--threshold`. An `asr` field in a line overrides the expected text (names, decimals, times: write it as Whisper does). **Offline-first**: when the model is already in the local HF cache it runs with `HF_HUB_OFFLINE=1` — no call to huggingface.co (same material: 145.9 s → 2.9 s, byte-identical `words.json`); a cache miss prints a clear notice and falls back to the network instead of hanging silently (see `LEMO_ASR_OFFLINE`) |
| `core/audio/sfx.py` | procedural foley and mix helpers: filters, envelopes, `click`, `whoosh`, `thump`, `ding`…, `compress`, `limit`, `add(buf, sound, at, gain, pan)` |
| `core/audio/sampler.py`, `core/audio/pluck.py` | sampled instruments and plucked-string modelling ([`audio/INSTRUMENTS.md`](audio/INSTRUMENTS.md)). A missing library is named in the error with its `fetch.sh instruments <lib>` command. `credits(names)` writes the CREDITS lines |

## Picture helpers

| File | What it is |
|---|---|
| `core/lib.js` | seeded random `mulberry`, `hash`, `vnoise`, `clamp(x,a,b)`, `lerp(a,b,t)`, `seg(t,a,b)` (0→1 between a and b), easing on 0–1 (`ss(t)`, `eio(t)`, `eo(t)`, `ei(t)`, `back(t,s)`, `spring(t,k,z)`), `monotone`/`track` interpolation, envelope `env` |
| `core/three/post.js` | three.js post: physical depth of field, GTAO, bloom, colour grade, 2× supersampling |
| `core/post/crt.js` | WebGL2 CRT / VHS pass over a 2D canvas |
| `core/fonts/` | Fredoka, Lilita One, IM Fell English, ZCOOL KuaiLe (OFL, [`fonts/OFL.md`](fonts/OFL.md)) as subsets; ZCOOL holds only ≈ 200 characters |
| `core/lang/lang.mjs` | language registry: `LANGS`, `langOf(C)` (unknown / missing `lang` falls back to `en`), `fontsToLoad(L)`, `isCJK`. One content file = one language version: the content's `"lang"` drives fonts, tracking, the roundel number prefix (`FIG.` → `图`) and the voice. **Adding a language is one entry here.** `core/lang/fonts-zh.css` + the subset woff2 in `core/lang/fonts/` are its Chinese default (the `roman` face is a **font stack** — `"Bodoni Moda", "Noto Serif SC"` — so Latin in a Chinese page keeps its own glyphs) |
| `core/render/size.mjs` | the only source of ratio→pixel arithmetic: `RATIOS` (first entry is the default, 9:16), `DEFAULT_RATIO`, `MIN_SIZE` / `MAX_SIZE` (96–8192; the floor is measured from the renderer's geometry — see the derivation there), `parseSizeSpec`, `resolveSize` (priority `size` > `ratio` > default; even sides, within MIN_SIZE–MAX_SIZE). `FALLBACK_SIZE` is the low-level tools' 1920×1080 default |
| `core/assets/polyhaven/` | CC0 HDRIs and models (`SOURCES.md`) |

## Environment variables

★ **Which process reads the `INDEXTTS_*` ones.** The Index-TTS script runs in two layers: an **outer** process (the one you start — in WSL for the `dub` path) and an **inner** one (the app's own Windows venv python, re-executed with `--inner`). `INDEXTTS_HOME` / `INDEXTTS_APP` / `INDEXTTS_PYTHON` / `INDEXTTS_REF_DIR` / `INDEXTTS_VOICE_LIB` / `INDEXTTS_TIMEOUT` / `INDEXTTS_STALL_TIMEOUT` / `INDEXTTS_LOCK*` are read by the **outer** — `export` them in WSL and they work. `INDEXTTS_ENGINE` / `INDEXTTS_QUANT` / `INDEXTTS_DEVICE` / `INDEXTTS_MIN_FREE_MIB` are read by the **inner**, and **WSL→Windows interop passes no environment variables at all** (measured 2026-10-05), so the outer translates those four into `--engine=` / `--quant=` / `--device=` / `--min-free-mib=` **argv** for the inner; the inner prints the values it actually took on a `内层配置` line at startup. Both routes work: `export` them in WSL (outer reads → argv → inner), or set them as **Windows** environment variables (the inner inherits the Windows environment; nothing is passed on its behalf).

| Variable | Meaning |
|---|---|
| `LEMO_OPUSCAR_HOME` | where `setup.sh` keeps the library (default `~/lemo-opuscar`) |
| `PLAYWRIGHT_CHROME` | a Chrome / headless-shell executable instead of Playwright's |
| `LEMO_ANGLE` | WebGL backend (default `metal` on macOS; `default` passes none) |
| `RENDER_SLOTS` | optional; limits concurrent full renders across processes |
| `LEMO_COLOR=bt709` | `mux.sh` writes limited-range BT.709 instead of the default full-range output |
| `WHISPER_MODEL` | Whisper model name or local folder for `asr_check.py` (same as `--model`; default `base.en` for English, `base` otherwise; `small` is more accurate for Chinese) |
| `LEMO_ASR_OFFLINE` | `asr_check.py` offline switch: `auto` (default — run offline with `HF_HUB_OFFLINE=1` whenever the model is already in the local HF cache, so no call to huggingface.co; a cache miss prints a clear notice and falls back to the network), `1` force offline (a cache miss fails fast), `0` force online |
| `HF_ENDPOINT` | Hugging Face mirror for the Whisper download |
| `INDEXTTS_HOME` | the Index-TTS 2.5 portable app's root folder (default `D:/Index-tts/Index-tts_v2.5`) |
| `INDEXTTS_APP` | its app folder, the working directory (default `<INDEXTTS_HOME>/app`) |
| `INDEXTTS_PYTHON` | the app's own Windows venv python (default `<INDEXTTS_APP>/.venv/Scripts/python.exe`) |
| `INDEXTTS_REF_DIR` | the official reference-clip folder (default `<INDEXTTS_HOME>/官方测试素材/参考音频`) |
| `INDEXTTS_VOICE_LIB` | a folder of the user's own reference clips; `voice` names resolve here too |
| `INDEXTTS_ENGINE` | inference path: `v2_5` (default) or `v2` |
| `INDEXTTS_QUANT` | `bf16` (default) or `fp32` on `v2_5`; `fp16` or `fp32` on `v2` |
| `INDEXTTS_DEVICE` | device; empty (default) = auto |
| `INDEXTTS_MIN_FREE_MIB` | free VRAM (MiB) required before the model loads; below it the precheck refuses to start. The default is a measured, tunable value inside `core/tts/tts_indextts.py` (`precheck_vram`) — read it there, don't copy a number |
| `INDEXTTS_TIMEOUT` | the TTS worker's timeout (s; default 3600) |
| `INDEXTTS_STALL_TIMEOUT` | watchdog: kill a worker that is alive but makes no progress for this long (s; default 300; 0 disables) |
| `INDEXTTS_LOCK` | the serial lock file (default `<INDEXTTS_HOME>/.indextts.lock`) |
| `INDEXTTS_LOCK_TIMEOUT` | how long to wait for the lock (s; default 7200) |
| `INDEXTTS_LOCK_STALE` | a lock older than this (s) counts as stale (default 21600) |

## Exit codes

| Tool | 0 | 1 | 2 |
|---|---|---|---|
| render tools | done | page error, missing required file, ffmpeg failure | usage, no `index.html`, `--out` already being written |
| `readcheck.mjs` | all texts long enough | some too short or never fully visible | could not check (no `TEXTS`) |
| `mux.sh` | film written | any failure | – |
| `tts.py`, `srt.py` | done | bad input, missing model, path too long | usage |
| `tts_zh.py` | done | bad input | network unreachable |
| `asr_check.py` | all lines pass | mismatches | model failed to load |
