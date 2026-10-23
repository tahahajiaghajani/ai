# Exhibition teaser — motion graphics

A Persian (RTL) teaser of about six minutes that loops on the TV behind the Pars Project Management booth: the company in numbers, the thirteen systems, a walkthrough of each product demo, the working AI copilot, the AI agents, Pars's capabilities, its clients and a QR code to the site. 1920 × 1080, 60 fps, H.264 with an original soundtrack. Nothing here is part of the website build; this folder has its own `package.json`.

## How it is made

The video is one HTML page (`src/`) animated with GSAP. The master timeline is never played: `render.mjs` seeks it to each frame time in Chromium and captures the frame, so every frame is a pure function of time. Workers render separate time ranges in parallel; ffmpeg encodes the chunks and joins them. The music is synthesized in Python from the same cue sheet, so cuts, callouts, clicks and AI scans land on their sounds.

| Chapter | What it shows |
|---|---|
| Intro | the two ribbons of the logo meet; logo and tagline |
| پارس در یک نگاه | 15+ years · 20 banks and organisations · 60+ organisations · up to 90% automation with human approval |
| سامانه‌های پارس | the thirteen systems of the demo hub |
| مدیریت پروژه · BSC · OKR · ۳۶۰ · FS · ارزیابی عملکرد · داشبوردها | a title card, then the demo in a browser window: the camera frames each region, a callout card explains it, a cursor moves between pages; infographics (the ten parts of a project file, the four BSC perspectives, the eleven UNIDO steps, the four angles of a 360 review); and a panel of what AI adds in the production version |
| دستیار هوشمند پارس | the real AI PM copilot: the cursor opens it on the PM dashboard, the chat panel lifts out and reports, links dashboards and writes WBS, team, risk and status into the system |
| ایجنت‌ها · توانمندی‌ها · مشتریان | the agent flow (read → understand → predict → act), the capability orbit, the client wall |
| Outro | QR to the site; fades to the dark the intro starts from |

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

The demo screenshots are not in the repository (they are the demo archives shared for the exhibition, named `project-0.png`, `bsc-2.png`, `copilot-11.png` …, as listed in `src/data.js`). `TEASER_URL` changes the QR address (default `https://parspmi.vercel.app`). `render.mjs --video` takes `--fps`, `--from`/`--to`, `--workers`, `--gain` (dB added to the music in the mux, default 2, which brings the mix to about −15 LUFS) and `--out`.

## Files

- `src/data.js` — every product: screens, callout regions (percent of each screenshot, x from the left), Persian copy, AI features, and the copilot steps. Edit copy here.
- `src/main.js` — chapter order, the stats, agents, capabilities and clients copy, bar quantization, the cue list.
- `src/scenes.js` — the scenes: intro, stats, overview, product chapters (title card, demo walkthrough, screen wall, infographics, AI layer), copilot, agents, capabilities, clients, outro.
- `src/engine.js` — the background (glows, silk ribbons, particles, grain), the browser window with pages, camera, callouts and cursor, word-by-word Persian type motion, the chapter bar.
- `src/teaser.html` — the stage and its CSS.
- `music/compose.py` — the soundtrack: D minor, pads, pluck arpeggio, bass, drums, a bell hook, risers, impacts and UI sounds placed from the cue sheet; sidechain, reverb, limiter; the tail folds into the start so the loop is seamless.

`out/` is a local build folder: `out/screens/` holds the original screenshots (the blur and retyped lines are applied at render time), so share the rendered mp4, never the `out/` folder.

Rules the video keeps: Persian moves by word, never by letter; only the approved facts appear; demo screenshots show sample data, and personal details in them (an e-mail address, a sample company name, a third-party model name) are blurred in place by `Page` in `engine.js`; one rendering glitch of the demo (raw markdown asterisks in a copilot reply) is covered by a retyped line; AI panels describe what the production version delivers, and only the copilot chapter shows AI working today.
