# Exhibition teaser — motion graphics

A Persian (RTL) teaser of about nine minutes that loops on the TV behind the Pars Project Management booth: the company in numbers, the thirteen systems, a walkthrough of each product demo, the working AI assistants, the AI agents, Pars's capabilities, its clients and how to reach Pars (site, e-mail, phones). The same engine renders a short teaser of each of six products (`--app`). 1920 × 1080, 60 fps, H.264 (BT.709) with an original soundtrack. Nothing here is part of the website build; this folder has its own `package.json`.

## How it is made

The video is one HTML page (`src/`) animated with GSAP. The master timeline is never played: `render.mjs` seeks it to each frame time in Chromium and captures the frame, so every frame is a pure function of time. Workers render separate time ranges in parallel; ffmpeg encodes the chunks and joins them. The music is synthesized in Python from the same cue sheet, so cuts, callouts, clicks and AI scans land on their sounds.

| Chapter | What it shows |
|---|---|
| Intro | the two ribbons of the logo meet; logo and tagline |
| پارس در یک نگاه | 15+ years · 20 banks and organisations · 60+ organisations · up to 90% automation with human approval |
| سامانه‌های پارس | the thirteen systems of the demo hub |
| مدیریت وظایف · آموزش PMBOK 8 | the two newest products open the walkthrough; each ends with the app's own AI assistant at work (TM: ready commands and voice answering «today's tasks»; PMBOK 8: suggested questions, a diagram on request, the AI analysis of the report card) |
| مدیریت پروژه · BSC · OKR · ۳۶۰ · FS · ارزیابی عملکرد · داشبوردها | a title card, then the demo in a browser window: the camera frames each region, a callout card explains it, a cursor moves between pages; infographics (the ten parts of a project file, the four BSC perspectives, the eleven UNIDO steps, the four angles of a 360 review); and a panel of what AI adds in the production version |
| دستیار هوشمند پارس | the real AI PM copilot: the cursor opens it on the PM dashboard, the chat panel lifts out and reports, links dashboards and writes WBS, team, risk and status into the system |
| ایجنت‌ها · توانمندی‌ها · مشتریان | the agent flow (read → understand → predict → act), the capability orbit, the client wall |
| Outro | the site, the e-mail and the phones (as on the booth); fades to the dark the intro starts from |

Chapters start on bar lines of the music (120 BPM, a bar is 2 s); a light sweeps across at every chapter change.

## Build and render

```bash
cd pars-website/marketing/teaser
npm install
export CHROME_PATH=/path/to/chrome            # or a Chromium installed for Playwright
node build.mjs                                # screenshots from screens/ (or SCREENS=/path/to/folder)
node render.mjs --chapters                    # chapter list; writes out/cues.json
python3 music/compose.py                      # out/music.wav from out/cues.json (numpy, scipy)
node render.mjs --video --audio true          # out/pars-teaser.mp4
node render.mjs --stills 40,95.5              # PNG stills in out/stills/
python3 tools/sheet.py out/sheet.png 40 95.5  # a contact sheet of those stills
```

**Short teasers.** `--app tm|pmbok|pm|bsc|fs|okr` builds one product's teaser (about 1½ minutes): a shorter intro, the product's chapter (PM adds the working AI copilot; `okr` pairs OKR with the organisational performance assessment) and the closing card. Every output carries the app's name, so several can render side by side:

```bash
node render.mjs --app tm --chapters                             # out/cues-tm.json
python3 music/compose.py out/cues-tm.json out/music-tm.wav
node render.mjs --app tm --video --audio true                   # out/pars-teaser-tm.mp4
```

The demo screenshots are not in the repository (they are the demo archives shared for the exhibition, named `project-0.png`, `bsc-2.png`, `tm-4.png`, `pmbok-8.png` …, as listed in `src/data.js`). `TEASER_URL` changes the site address the video shows (default `https://parspmi.ir`); the e-mail and phones are `DATA.contact` in `src/data.js`. `render.mjs --video` takes `--fps`, `--from`/`--to`, `--workers`, `--gain` (dB added to the music in the mux, default 2, which brings the mix to about −15 LUFS) and `--out`.

## Files

- `src/data.js` — every product: screens, callout regions (percent of each screenshot, x from the left), Persian copy, AI features, and the copilot steps. Edit copy here.
- `src/main.js` — chapter order, the short teasers (`SHORTS`), the stats, agents, capabilities and clients copy, bar quantization, the cue list.
- `src/scenes.js` — the scenes: intro (and its shorter form for the app teasers), stats, overview, product chapters (title card, demo walkthrough, screen wall, infographics, AI layer), copilot, agents, capabilities, clients, outro with the contact card.
- `src/engine.js` — the background (glows, silk ribbons, particles, grain), the browser window with pages, camera, callouts and cursor, word-by-word Persian type motion, the chapter bar.
- `src/teaser.html` — the stage and its CSS.
- `music/compose.py` — the soundtrack: D minor, pads, pluck arpeggio, bass, drums, a bell hook, risers, impacts and UI sounds placed from the cue sheet; sidechain, reverb, limiter; the tail folds into the start so the loop is seamless.

`out/` is a local build folder: `out/screens/` holds the original screenshots (the blur and retyped lines are applied at render time), so share the rendered mp4, never the `out/` folder.

Rules the video keeps: Persian moves by word, never by letter; only the approved facts appear; demo screenshots show sample data, and personal details in them (people's names, real organisations, e-mail addresses, a third-party model name, a test record's name) are blurred in place by `Page` in `engine.js` or retyped as role titles or neutral sample text (`patches`, in each app's own face: Vazirmatn on the TM, PMBOK 8 and BSC screens, IBM Plex Sans Arabic on the 360 screens); rendering glitches of the demos (raw markdown asterisks) are covered by retyped lines; AI panels describe what the production version delivers, and the copilot, TM and PMBOK 8 chapters show the AI that works today.

Before a new render is shared, check every screenshot the teaser uses at full resolution, small text included (sidebars, chips, selectors, table rows, chat bubbles, footers), for people's names, e-mails, phone numbers, model names and URLs other than parspmi.ir, and cover each with a patch. Then look at the rendered frames for patches that sit off their line or text the camera cuts in half.
