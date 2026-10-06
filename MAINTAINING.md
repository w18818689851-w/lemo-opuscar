# Maintaining the library

**For the repository owner only.** If you are making a film for a user, go back to [`AGENTS.md`](AGENTS.md): nothing here applies.

## Add a style

Work in `styles/<slug>/` (lowercase letters, digits, hyphens; unique). Start from the templates in `styles/_template/`.

| File | What it holds |
|---|---|
| `style.json` | the only metadata source: `slug`, `num`, `en`, `cn`, `category_en`, `category_cn`, `film`, `line`, `line_cn`, `uses`, `frame_sec`, `dur` |
| `STYLE.md` | the style's invariants only: look, materials and rendering, colour logic, type, motion, camera grammar, sound palette, the medium's pitfalls, native moves, range of variation. No story, arc, beat table, durations or end card. Ends with a link to `DEMO.md` |
| `DEMO.md` | opens with "One example among many. Don't reuse its story, arc, shots, props or timings." Then the demo's story and structure, shot list, score structure, palette and props, end card (the "LemoLab × Claude Opus 5.5" sign-off lives only here, as the library demo's), build notes and code entry points, and for a scene style the `content.json` fields |
| `demo/` | the source, a one-command `build.sh` and `CREDITS` are committed, for agents to read. `TREATMENT.md`, `PRODUCTION_LOG.md`, fonts, audio, textures and models stay local (gitignored); `CREDITS` names every asset so it can be found again |
| `demo/stills/` | stills the docs link (`styleframe.jpg` is the gallery card) |
| `<slug>.mp4`, `<slug>.srt`, `poster.jpg` | the 1080p film, its subtitles when it is spoken, its poster |

Assets are CC0, CC BY or OFL only, each in `demo/CREDITS`. No watermark on any film. Real people, brands and events appear only in an unofficial fan film; its `DEMO.md` says so.

**A fresh clone has no fonts — fetch them before rendering a demo.** `styles/*/demo/fonts/**` is
gitignored (`.gitignore:63-64`, `:77-78`), so a new clone arrives with **0 of the 954** font files across
**all 41** demos that ship a `demo/fonts/`. Each `fonts.css` then points at files that are not there — the
tool prints `optional file missing: <URL>` and carries on, so every face falls back to a system font.

```sh
bash tools/fetch-fonts.sh                 # all 41 demos
bash tools/fetch-fonts.sh --only woodcut  # one style (repeatable, space-separated)
FONT_PY=.venv/bin/python bash tools/fetch-fonts.sh   # if fontTools lives in the library venv
```

**It needs the network — that is the cost.** Sources come from `google/fonts` through three mirrors in turn
(jsDelivr → raw.githubusercontent → gitmirror) and are converted locally with `fontTools` + `brotli`, so
**an offline machine cannot fetch them** and keeps the fallback. *Why they are not committed:* 954 files is
bulk the repository should not carry, and this script is the judged way to regenerate them — `CREDITS` in
each `demo/` names every face. *How to judge:* after a fetch, this must print **954**:
`find styles -path '*demo/fonts*' \( -name '*.ttf' -o -name '*.woff2' \) | wc -l`

**The audio chain a style must expose.** The orchestrator finds and runs a style's audio as three
separate, filename-matched steps — music, foley, mix — so a style whose mixing lives inside a script the
search classifies as "music" is not broken, it is *mis-shaped*, and it fails the whole render. That is
exactly what left `game-show`, `halftone-dossier` and `pictogram-motion` unable to produce a film in the
theme path until each was given a thin `demo/mix.py` shell.

- **The mix script is found at exactly three paths, in this priority:** `demo/mix.py` → `demo/sound.py` →
  `demo/audio/mix.py` (the `MIX` candidate line in `lemo-make.mjs`). *Why:* the search is a fixed candidate list, so any other
  name is invisible and the step dies with `STEP_FAIL 该 demo 没有 mix.py / sound.py / audio/mix.py`.
  *How to judge:* on that line, grep the demo for `loudnorm`/`ffmpeg`/`sf.write` and wrap what you find in
  one of the three names.
- **It is called as `.venv/bin/python "$MIX"` with no arguments, from the library root** — the audio chain
  does `cd "$LIB"` first in `lemo-make.mjs`, *not* `cd demo/`, and the call carries no argv (`:2302`).
  *Why:* a script that resolves inputs against the current directory reads the wrong tree and dies on a file
  that is actually present. *How to judge:* run it from an unrelated cwd — it must still work, because it
  derives every path from `__file__`.
- **It must leave a `mix.wav` where the orchestrator looks:** `demo/mix.wav` (preferred), then
  `demo/audio/mix.wav`, then `demo/out/mix.wav`; the orchestrator keeps the one newer than the marker it
  touched before the run and prints `MIX_OK <bytes> <path>` (the `MIX_OK` line in `lemo-make.mjs`). *How to judge:* the
  run must end in `MIX_OK` naming the file you just wrote — a silent success with no `mix.wav` fails.
- **One script serving both music and mix runs once** (`MUSIC_DEDUP` in `lemo-make.mjs`). *Why:* the
  two searches overlap — `$D/sound.py` sits in **both** candidate lists (`:2062` and `:2068`) — and running it
  twice would regenerate the score after it was mixed. *How to judge:* only `living-screencast` hits this
  today; the cleaner fix is a dedicated `demo/mix.py`, which only the mix search matches.
- **The music side is deliberately asymmetric:** it also accepts `$D/music.py` and `$D/music/music.py`
  (the `MUSIC` candidate line in `lemo-make.mjs`). *Why:* that asymmetry is the root of the trap — a style that merged its
  mixing into `music.py` / `music/music.py` (or into `finish.sh` / its own `mux.sh`) has a working audio
  chain the mix search cannot see. *How to judge:* test the three mix names against the demo; if none exists
  but audio is clearly produced elsewhere, add the `demo/mix.py` shell.
- **Delivery, in numbers:** the finished film must measure **true peak ≤ −1.2 dBTP** and **loudness ∈ −14 ± 1
  LU**. `core/render/mux.sh` already closes this loop — encode, re-measure the *film*, and if a line is
  missed, lower the TP target and redo **only the audio** (`-c:v copy`) until both hold
  (`core/render/mux.sh:4-5`, `:70-77`). *Why:* AAC lifts the source PCM's inter-sample peak by a
  non-monotonic 0.08–1.66 dB, so no fixed target works. *How to judge:* **a style that ships its own
  `mux.sh` must carry the same loop** (`LEMO_LN_TP_STEP` / `LEMO_LN_TP_TRIES`, judged on loudnorm's
  `input_tp`), or a hot master exceeds TP with no fallback — `scripts/check-film-delivery.mjs`'s **E class**
  fails exactly that (`:180-258`).
- **A `#!/bin/zsh` trap that costs a whole film:** zsh parses `offset=$_o:linear=true` as its `:l`
  (lowercase) modifier, so the value becomes `offset=0.42inear=true` and `loudnorm` rejects it — `paper-popup`
  could not render for this reason (`styles/paper-popup/demo/mux.sh:40-41`). **Always brace:** `${_o}`. POSIX
  `sh` has no such modifier; the fix is already in `watercolor`, `backrooms`, `cel-anime-80s`, `crayon-book`.

**A spoken film needs free VRAM before the voice step — free the card first.** The audio chain above
leaves out its first step: the voice. When the voice is synthesised locally by **Index-TTS**
(`core/tts/tts_indextts.py`, the `indextts` engine), that step loads a 3.2 GB model onto the GPU and
refuses to start below a free-VRAM floor — `INDEXTTS_MIN_FREE_MIB`, whose default is defined by the
`VRAM_MIN_MIB` constant in `core/tts/tts_indextts.py`, beside `precheck_vram()`.

- **The constraint.** One **8188 MiB** card (RTX 4060, WDDM) that typically shows around **7000 MiB
  free** — the floor sits close to what is actually there. *How to judge:* read the free figure before
  the run — `nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader`.
- **What happens without it.** The `dub` path (a user's copy → film) does **not** mis-render quietly:
  it **fails at the TTS precheck** — the script refuses to load the model and exits, printing the free
  and the required MiB, instead of hanging. *Why:* a resident model leaves too little — `qwen2.5-vl-7b`
  has been measured holding **7281 of 8188 MiB** — and a resident model once left an Index-TTS run
  **hung and silent for an hour**; the precheck turns that into a fast, loud failure. *How to judge:*
  the run stops at the precheck and prints `可用 … MiB / 共 … MiB … 需要至少 … MiB`.
- **Two ways out.** (i) **Free the card** — quit whatever holds the GPU and **unload any resident large
  model** (in LM Studio, or run it with `num_gpu=0` on the CPU); the project rule is *free the VRAM
  before a film*. (ii) **Override the floor on purpose** — set `INDEXTTS_MIN_FREE_MIB=<MiB>`, accepting
  the OOM/hang risk the check exists to prevent (the extreme form, `INDEXTTS_MIN_FREE_MIB=0`, disables
  the check). *How to judge:* prefer (i); reach for (ii) only when you know the run fits — the floor
  guards a **large** shortfall, not a 200 MiB one. ★ **(ii) works from the `dub` path as well** (fixed
  2026-10-05): `dub.mjs` now writes `export INDEXTTS_MIN_FREE_MIB=<MiB>` into the WSL script it runs,
  and the script's outer (WSL) python reads it and hands it to the inner Windows python as
  `--min-free-mib=<MiB>` — WSL→Windows interop carries **no** environment variables, so argv is the
  only channel. *How to judge:* the effective floor is printed on the inner config line
  (`tts_indextts.py: 内层配置 —— … min_free_mib=…`) — read it to confirm your value landed.

## Let a film support more than one aspect

The renderer screenshots the **browser viewport** (`page.screenshot()`), so `--size WxH` / `--ratio <a:b>` sets the
viewport. The page must size its canvas to the viewport (see `styles/engraving/demo/main.js`), and the film module
must re-derive its layout from that frame. **A film that still draws at absolute 1920×1080 pixels will be cropped
when the viewport is not 16:9** — not re-laid-out, not letterboxed. `styles/engraving/demo/film_coffee.js` is the
worked example; its rule is:

1. **Take the frame from `opts`, never from a constant.** `makeFilm(C, voiceDur, opts)` starts with
   `const W = opts.W ?? NATIVE.W, H = opts.H ?? NATIVE.H;` — the fallback keeps the design frame for any caller
   that never asked for a size.
2. **One `layout(W, H)` derives everything.** `fx = W / NATIVE.W`, `fy = H / NATIVE.H`, `S = Math.min(fx, fy)`.
   Then:
   - **positions stretch by axis** — a point at design `(x, y)` becomes `(x * fx, y * fy)`, so the plate, its
     border, the four roundel slots and the chart strip always fill the frame (`PLATE`, `BORDER`, `SLOTS`,
     `STRIP` in `layout()`);
   - **sizes scale by the tighter axis** — every radius, type size, rule weight and leading multiplies by
     `S`, so ink keeps its weight and two label columns still fit between the roundels and the plate edges on a
     narrow, tall frame (`RR = 84 * S`, `NOTE.size = 27 * S`, `LEAD = 19 * S`, …).
   Keep the derived values in one object and read them from there; never re-derive a coordinate at the draw site.
3. **At 1920×1080 every expression must reduce to exactly the number it replaced.** `fx = fy = S = 1`, so
   `70 * fx === 70`, `84 * S === 84`. That is what makes the 16:9 picture byte-for-byte what it always was.
   Preserve fractions of the *height*, not pixel offsets: `CY = 470 * fy` keeps the figure where the design put it
   (470 of 1080) on any frame. Anything that mixes axes (a fold sweeping the frame, a vignette radius) needs its
   own `Math.hypot(W, H)`-style term — see `drawPeel()`.
4. **Nothing may be evaluated at module load.** The layout needs `W` and `H`, which only exist inside `makeFilm`.
   Constants like `NATIVE` and `BEAT` are fine at top level; geometry is not.
5. **Declare what you actually support.** Put the ratios the film *really composes correctly* in
   `FILM_META.aspects`:
   ```js
   export const FILM_META = { id: 'coffee', title: 'Coffea arabica', style: 'Copperplate Engraving',
     aspects: ['16:9', '9:16', '3:4', '4:3', '1:1'] };
   ```
   **Omitting `aspects` means "16:9 only"** — i.e. "not adapted", which is the honest default and what every
   un-migrated film says. The console reads this declaration as **source text** (the module is a browser ESM and
   cannot be imported by Node) and warns the user before rendering into a frame the film will crop; see
   `D:\lemo-tools\lib\aspects.mjs`. So keep `aspects` a **literal array** — an expression that is only computed at
   runtime cannot be probed.
6. **Verify by rendering, not by reading.** Render stills at each claimed ratio at a few times that show the whole
   plate *and* the close-ups, and check: the plate mark is complete, the four roundel labels do not overlap, the
   chart strip does not overflow, and subtitles stay inside the frame. Compare 16:9 against the pre-change build.
   ```sh
   node core/render/still.mjs styles/<slug>/demo 30.9 --q "film=<film>&nosub=1" --size 1080x1920 --out /tmp/a
   ```

**The census — `aspects` is a claim, so count it instead of remembering it.**

```sh
grep -ho "aspects: \[[^]]*\]" styles/*/demo/film.js | sort | uniq -c | sort -rn
#   28  aspects: ['16:9', '9:16']
#   14  aspects: ['16:9', '9:16', '3:4', '4:3', '1:1']
```

That is the whole census, and it is the only one to quote. Scope: `demo/film.js` only — the console probes
`demo/film*.js` (`D:\lemo-tools\lib\aspects.mjs`), and `styles/engraving/demo/film_coffee.js` is a **second
film** of the same style, so the glob over `film*.js` counts `engraving` twice (15, not 14). 42 of the 43
styles have a `demo/film.js`; `pixel-rpg` has none (`_template` is a template, not a style). So the honest
statement is: **14 styles claim five ratios, 28 claim two, 1 claims nothing** (declaring nothing means
"16:9 only" — see step 5).

**The policy: a declared ratio means "this ratio will not be cropped", and containing is a legitimate way
to earn it.** Two implementations are in use, and **both are correct** — native re-layout is the *better*
result, not a requirement:

- **Re-layout — 10 styles.** The layout is re-derived from the real frame (`fx`/`fy`/`S`, step 2 above):
  `engraving`, `dark-keynote`, `dataviz`, `one-line`, `silkscreen-poster`, `spy-titles`, `stained-glass`,
  `swiss-motion`, `urban-sketch`, `woodcut`. The picture is composed *for* the frame, so there are no bars.
- **Contain (等比装入) — 32 styles.** The design frame stays 1920×1080; the whole frame is scaled
  uniformly into the current frame and centred, and the bars take the page's own background colour. The
  picture is complete and undistorted, but it only fills part of the frame — at 9:16 (1080×1920) a
  1920×1080 design frame lands as 1080×608, i.e. **31.6 %** of the pixels; at 3:4 (1440×1920) 42.2 %; at
  4:3 (1920×1440) 75 %; at 1:1 (1920×1920) 56.25 %. The rest is bar. The **13 five-ratio styles** that
  contain are `backrooms` (#000), `brick-toy` (#f4f4f1), `cel-anime-80s` (#1f2446), `game-show` (#F4ECDD),
  `halftone-dossier` (#F4ECDD), `hd-2d` (#0b1526), `hologram-hud` (#02080A), `microgame` (#2a0f5c),
  `paper-lantern` (#0a1330), `paper-popup` (#fffaf0), `pictogram-motion` (#fbf6ec), `risograph` (#F6F1E6),
  `tilt-shift` (#8fb4d8) — each records its bar colour and its own cost in `STYLE.md §11.1`. The other 19
  contain, but claim only 16:9 + 9:16.
  *Some styles do both*: `dark-keynote` contains its **world** and re-lays-out its **screen furniture**
  (bars, captions, end card) — judge a style by what its own header comment says, not by the two labels.

**Traps the worked example does not show.** The traps below are the price of the **re-layout** family —
the rule above is what they cost, and they do not apply to a style that only contains. Four traps
recurred, and each is **silent** — a crop, a misalignment or a doubled zoom, never an exception — so only
the step-6 render check catches them.

- **`S` is usually already taken — rename the incumbent, keep `S` for the factor.** Step 2's
  `S = Math.min(fx, fy)` collides with the score object or the scene-state object that many modules
  already call `S`. Rename the **old** binding, because the factor is read at every draw site while the
  old name is read in a few. The rename must be **mechanical and complete** — every reference,
  destructuring pattern and `import { … }` list. In practice `styles/spy-titles/demo/paper.js:24`
  renamed the paper/scene-state object `S` → `ST`, and `styles/living-screencast/demo/main.js:122`
  renamed `wipe()`'s parameter/local `W`/`S` → `WS`/`BS` and `hud()`'s `H` → `HU`. **Judge it by the
  diff:** 16:9 must be byte-for-byte what it was; a missed rename either throws `ReferenceError` or
  silently reads the wrong object.
- **Screen-space furniture is not "× `FX`/`FY`".** Parallax layers, blinds, the end card and page
  numbers are laid out in the **design frame**, so scaling each axis independently shears them against
  the world inside the camera; send them through the same **design-frame → current-frame uniform fit**
  the world uses — `dXf()` in `styles/spy-titles/demo/paper.js:13`, applied to the blinds at
  `film.js:104` and the end card at `frames.js:164`. A shard strip is the other way round: its snapshot
  is already current-frame-sized, so it is frame-space, laid out at `W`/`H` with width `260 * S`
  (`film.js:330`).
- **World coordinates must not be multiplied by `FX`/`FY` again.** `cam()` already folds `S` into its
  zoom (`styles/spy-titles/demo/scenes.js:10`: `const z = s * S`), so re-applying the axis factors
  double-scales the world. **Judge it by zoom:** at 9:16 the camera subject must land where the camera
  put it, not halfway out of frame.
- **A style with full-frame overlays needs two classes, not one.** HUD, subtitles and full-frame
  overlays (wipe / flash / fade / spotlight) belong to the **current frame**, not the design frame:
  their positions take `FX`/`FY` and their sizes take `S`, so they cover the whole viewport
  (`styles/spy-titles/demo/frames.js:9`; `styles/living-screencast/demo/main.js:13`). Only genuinely
  **world-mapped** screen positions — a spotlight's centre, a toast anchored to an element, a cursor —
  go through the world→current-frame conversion (`scr()` at `main.js:106`). Sending everything through
  `dXf()` looks right on 16:9 and fails on 9:16: in `living-screencast` the wipe then covered only the
  central band, because the uniform fit letterboxes.
- **Three smaller ones, each seen once and cheap to repeat.** (i) **Integer rounding before scaling**
  shrinks the frame: `Math.round(700 / NUM_ASC)` became `Math.round(700 * S / NUM_ASC)` in
  `styles/swiss-motion/demo/film.js:249`, or the numeral measures smaller than designed on a narrow
  frame. (ii) **A sub-module that reads `FX`/`FY`/`S` must import them** — they live in the module that
  owns `setFrame` (`paper.js:9`), and a missed import is a `ReferenceError` only when that branch runs.
  (iii) **Geometry may not be computed at module load** (step 4): `NUM_SIZE`/`NUM_ASC` is exactly that
  trap — its first value is recomputed inside `layout()` once `W`/`H` exist (`film.js:268` → `:249`).

## When a film cannot be re-laid-out: the page-shell uniform fit

Some films are too expensive to convert to `layout(W, H)`: `cel-anime-80s` is 17 files / 2438 lines of
per-shot absolute coordinates plus a multi-pass WebGL2 CRT; `risograph` would need ~700 literals each
judged "position or size"; the three.js films own their own camera and post chain. Rewriting their draw
calls is not worth it, and a missed spot fails **silently** (the picture still renders — it is just wrong).

For those, do **not** touch the drawing code at all. Render at the design frame and fit the *page*:

1. **Leave the film alone.** It keeps drawing into a canvas whose size *is* the design frame
   (`1920×1080`). Because that path is unchanged, 16:9 stays byte-for-byte what it was.
2. **Wrap the page.** In `demo/index.html`, put the on-screen canvas (and any overlay element) inside a
   wrapper and give it `transform: scale(k)` + centring, `k = min(W/1920, H/1080)`. Fill the leftover
   band with the style's letterbox colour.
3. **Touch nothing at 1920×1080.** Branch on the viewport: when it *is* the design frame, apply no
   transform and no wrapper geometry, so the 16:9 path cannot drift by a sub-pixel.
4. **Declare it.** The console probes `demo/film*.js` only, so add the thin `film.js` carrying
   `FILM_META.aspects` (`backrooms/demo/film.js` is 11 lines).

**What it costs — say it out loud, do not hide it:**
- **Uniform fit, not a re-layout.** Proportions hold and nothing is cropped, but a 1080p-native film
  occupies only `1080×607` of a 1080×1920 frame; fine halftones and scanlines can moiré.
- **Full-frame overlays stay inside the design box.** VHS noise, OSD and scanlines do **not** reach the
  letterbox band (`backrooms` measured `YAVG = 0` there). Same trap `living-screencast` hit with its
  wipe — the page-shell fit cannot fix it.
- **The band needs a colour.** Without one it is pure black, which on a 4:3 source reads as "small
  picture in a big black frame".
- **It cannot preserve integer pixel blocks.** A film whose look *is* its pixel grid is out of scope:
  at 9:16 the fit factor is `k = 1080/1920 = 0.5625`, so `pixel-rpg`'s exact 6 px blocks become
  **3.375 px**, and the nearest-neighbour runs alternate 3/4 px (73% of runs) — the grid stops being a
  grid. `image-rendering: pixelated` *does* survive `transform: scale()` (measured: 30 colours with
  `pixelated` vs 1672 with `auto`), so this is not a blur problem — it is an arithmetic one. Keeping the
  blocks integral needs `k = 0.5`, which leaves only `960×540` (25% of a 1080×1920 frame). **Leave such a
  film at 16:9 and say so** rather than shipping a broken grid.

**How to judge it worked** (three checks, not interchangeable):
1. **16:9 unchanged** — byte-for-byte md5 against the pre-change render *within one session*
   (`1920×1080 → 1080×1920 → 1920×1080`). ★ Cross-process md5 is unusable when the post chain is
   non-deterministic (GTAO/bloom: `lowpoly-island`, `backrooms`) — use PSNR plus the *same-frame-twice*
   noise floor instead.
2. **9:16 is a fit, not a crop** — SSIM against a centre-crop must be well below 1 **and** SSIM against an
   *ideal* uniform fit must be near 1 (`backrooms`: **0.395** vs **0.991**). The second number is what
   proves the mechanism.
3. **Look at it** — confirm the subject and the subtitles sit inside the frame, then decide whether the
   band is acceptable for that style.

## Add a language version

A language version is a **content file**, not a branch of the drawing code. The content's `"lang"` field
selects everything language-dependent; the page and the film module read it through `core/lang/lang.mjs`
and never test for a language themselves.

1. **Add the entry.** One record in `LANGS` (`core/lang/lang.mjs`). Its key is both the `--lang` value and
   the content file's `"lang"`. It holds `fonts` (roman / script / Latin), `track` (per-element letter
   spacing), `labelPrefix` (the roundel number prefix, `FIG.` → `图`), `cps` (fallback reading speed) and
   `tts` (`lang` / `voice` / `speed`, and `engine` when it is not `kokoro`).
2. **Add the font CSS.** Put subset woff2 files in `core/lang/fonts/` and a `fonts-<code>.css` beside them
   (copy `fonts-zh.css`); the `@font-face` `font-family` must match the names in step 1 **character for
   character**. For a CJK language the `roman` face must be a **font stack** (`"Bodoni Moda", "Noto Serif
   SC"`): a CJK subset also covers printable ASCII, so a lone CJK family would steal the glyphs of Latin
   names, figures and the credit line.
3. **Write the content file** `styles/<slug>/demo/content_<id>.<code>.json` with `"lang": "<code>"` inside
   it — that is the only switch; forget it and the page falls back to `en`. Translate title / series /
   plate no. / detail names and notes / caption / signature / end card / `voice.lines[].text` /
   `stations{}` (station keys are language-independent anchors). **Both libraries need the file**: voice
   derivation and the subtitle step run on the WSL side.
4. **Keep the fallback honest.** `langOf(C)` returns `en` for a missing or unknown `lang`, and
   `fontsToLoad(L)` preloads only the weights the faces actually use. The un-suffixed content files *are*
   the English version, so the English command line must stay byte-for-byte what it was (`--lang en` is
   not passed).
5. **Verify on the picture.** Render a still of a text-heavy frame and read it: Latin inside a CJK page
   keeps its own glyphs, the roundel prefix changes, and no line overflows. The CJK path **skips
   `asr_check` on purpose** (see TECHNIQUE.md §4) — the skip is keyed on `lang`, so don't "fix" it.

## Output size

`core/render/size.mjs` is the **only** place the ratio→pixel arithmetic lives (`RATIOS`, `DEFAULT_RATIO`,
`parseSizeSpec`, `resolveSize`); the orchestrator and the console import it instead of copying the table.
Two defaults, on purpose:

- **The publishing flow defaults to 9:16** (`DEFAULT_RATIO`, the first entry of `RATIOS`) and passes
  `--size WxH` down to the render tools explicitly.
- **The low-level tools keep 1920×1080** (`takeSize` in `still.mjs` / `video.mjs`). The **35** demos that
  ship a `build.sh` (8 of the 43 styles ship none: `brick-toy`, `cel-anime-80s`, `game-show`,
  `halftone-dossier`, `hd-2d`, `paper-popup`, `pictogram-motion`, `watercolor`) call them without `--size`
  and compose at 1920×1080; moving the default down there would crop all 35. The count and the "no size
  passed" claim are both machine-checkable: `ls styles/*/demo/build.sh | wc -l` → 35 and
  `grep -l -- --size styles/*/demo/build.sh` → empty.

`--size` beats `--ratio`; a custom size must be even and within `MIN_SIZE`–`MAX_SIZE` on both sides
(96–8192 — the floor is the renderer's measured geometric minimum, not a round number; see
`core/render/size.mjs`. H.264 `yuv420p` wants even sides).

**The sample films are always 16:9 / 1920×1080 — the delivery default is not their default.** The 43
`D:/lemo-films/<slug>/<slug>.mp4` files are the library's **sample films**: the design frames a style is judged
by, and the films `styleboard/build.py:31-49` re-reads each `style.json`'s `dur` from. A sample film that is not
16:9 is a measurement taken off the wrong picture.

- **The orchestrator defaults to 9:16 — the *delivery* default, not the sample default.** `lemo-make.mjs`
  falls back to `DEFAULT_RATIO: '9:16'`, so a bare `node lemo-make.mjs <slug>` renders 1080×1920. **Re-rendering a
  sample film must pass `--ratio 16:9` explicitly**; `scripts/style-distill.mjs:189` is the one place that does.
  *Why:* 9 styles declare no `FILM_META.aspects`, and this library reads **no declaration = 16:9 only** — a 9:16
  render yields a frame those styles never claimed to compose. *How to judge:* `ffprobe` the file you wrote; it
  must be **1920×1080**.
- **Without `--out` the film is written straight onto the sample path.** `lemo-make.mjs`
  (`outDir = o.out || path.join(CFG.exportDir, o.slug)`; `CFG.exportDir = 'D:\\lemo-films'`, `:42`) and the export
  step lands on `path.join(outDir, '<slug>.mp4')` (`:2593`). **Any new film must carry an explicit `--out`.**
  *Why:* this is how `D:/lemo-films/art-deco/art-deco.mp4` was overwritten at 1080×1920 on 2026-10-05. *How to
  judge:* read the `输出` line the run prints (`:1370`) before it renders. The console now writes
  `D:/lemo-films/_jobs/<task id>/` and cannot touch a sample film — but a hand-run `lemo-make.mjs` still
  defaults to `D:/lemo-films/<slug>/`, so "the console is safe" is not "my shell is".
- **A local sample copy can be re-rendered to the wrong length — `dur` follows the *published* film, not the copy.**
  `D:/lemo-films/pictogram-motion/pictogram-motion.mp4` is a **local re-render** — **161.6 s / 24 fps / 3878 frames**
  — not the published sample; the published film (the `films` release asset) is **163.6 s / 60 fps / 9816 frames**,
  which is what `demo/mux.sh` (its `tpad=stop_duration=2` tail), `DEMO.md` ("163.6 s, 9816 frames") and `style.json`'s
  `"dur": 163.6` all say. *Why:* `style.json.dur` is the runtime the gallery shows, and `styleboard/catalog.json`
  is built from it — reading it off a hand-overwritten local copy puts a wrong runtime on the card. *How to judge:*
  `ffprobe` the local file and compare **both** duration and frame rate against the line `DEMO.md` records; the
  other 42 styles match their published film exactly (spot-checked watercolor 113.6, art-deco 58.4, hd-2d 76.5,
  brick-toy 54.0), so a single mismatch means the local copy was overwritten — do not "fix" `style.json` to match it.
- **What the gates catch.** `check-film-aspect.mjs`'s **C class** (`:214-244`) ffprobes every sample film and
  FAILs unless it is **exactly 1920×1080**, naming the slug and file (`C 样板片画幅被改`, `:241`);
  `check-film-delivery.mjs`'s C class compares the declared `generatedVideo.width/height` against the real file
  (`:164-167`). **`style-scan.mjs` will not catch it** — its fingerprint excludes `.mp4` (`:25`), so an
  overwritten sample film leaves the fingerprint intact.

**Sample film vs delivered film — two different products.** The sample film is the 16:9 **design reference**. A
delivered film follows the caller's `--ratio` (9:16 by default) and lands where the caller puts it:
`D:/lemo-films/_jobs/<task id>/` from the console, or the `--out` directory on the command line. Do not "fix" a
delivered film by rendering it into `D:/lemo-films/<slug>/`.

## Register

1. **Number.** `num` in `style.json` is the next free number after the highest in `styles/*/style.json` (two digits as a string, e.g. `"55"`); it orders the gallery within a category.
2. `python3 styleboard/build.py` reads every `styles/*/style.json` and rewrites the gallery data, the grids and counts in `README.md` (English) and `README.zh-CN.md` (Chinese), `styles/README.md` and the style list in `AGENTS.md`. Never edit those generated parts by hand. The rest of the two READMEs is written by hand: change both together (e.g. the **New** line). Then `python3 styleboard/build.py --frames <slug>` (the README grid frame at `frame_sec`) and `sh styleboard/frames.sh <slug>` (the gallery card from `demo/stills/styleframe.jpg`).
3. `sh tools/web_cuts.sh` makes the 720p web cut in `.release/web/` (only for films that are new or changed).

## Gates

- **Human:** approve the style frame before production, and the finished film.
- **Machine:** `asr_check.py` passes on every line; `mux.sh` reports **both delivery calibers** — loudness ≈ −14 LUFS (±1 LU) **and true peak ≤ −1.2 dBTP** — with no warning (it now closes the loop itself: encode, re-measure the *film*, and if a line is missed, lower the TP target and redo only the audio); `readcheck.mjs` passes; `python3 tools/release.py check --strict <slug>` is clean (it needs the Register steps above).
- **Real events and products:** every fact on screen and in the voice-over comes from an official source, kept in `demo/FACTS.md` (claim, URL, quoted wording); check the final script against it before the last render.

## Publish

1. `sh tools/publish.sh` uploads the full films (`films` release) and the 720p web cuts (`web` release, used by the gallery), then verifies them. Per-demo resource packs are no longer published.
2. `git status --short`, `git add -A`, commit.
3. Push `main`, then watch CI (`gh run watch`): the gallery build fails when a card links a film that isn't on the `web` release.

The Pages build (`build.py --site`) also writes the OPUSCAR 98 page (`opuscar98/`, from `styleboard/opuscar98.html`), `llms.txt` and `sitemap.xml`, and puts the canonical link, share-card tags and JSON-LD (upstream repo and author) in each page's head. They pick up the style count by themselves; the film's runtime is `FEATURE['dur']` in `build.py`.

Don't push before the upload has finished, and don't commit `tools/assets.json` from a failed run.

## Revise a style

Back up first (old versions move out of the repository, not into git). Re-render, replace `<slug>.mp4`, and run `sh tools/publish.sh`: it re-uploads the film and refreshes its web cut.
