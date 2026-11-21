# Story

A 17-second vertical film (1080 × 1920, 30 fps) and a still poster for Telegram and Instagram stories, in the site's
own black-and-white identity. A free Telegram story cannot carry a link, so the site's address is written in the
frame: as a lower third through the film, then decoded inside a detection box on the end card, with a QR code beside
it. The finished end card is held for four seconds, because neither app loops a story or keeps its last frame: that
is the time a viewer has to read the address and take a screenshot.

Nothing in this folder is served by the site. `story.html` and `story.js` draw everything from the site's own assets
(`../public`, the hero's portrait shader, the mark, the faces copied into `fonts/`) on one GSAP timeline.
`window.renderAt(seconds)` puts the page at any instant, so the film is rendered frame by frame, not recorded.

## Render

Needs Node, Playwright with Chromium (`require("playwright")`) and ffmpeg. From the `portfolio` folder, after
`npm install` (GSAP is read from `node_modules`):

    node story/render.js --sub 16 --shutter 8 --query "?fps=30"     # story/out/master.mkv (lossless)
    bash story/encode.sh story/out/master.mkv story/out/story.mp4   # H.264, BT.709, a silent stereo track
    node story/frame.js --still                                     # story/out/still.png
    node story/frame.js 0 4 9.6 17                                  # single frames, for checking

`--sub` is how many instants are rendered for each frame and `--shutter` how many of them are averaged (motion blur).
With `?fps=30`, whatever changes in steps (the decoding labels, the counters, the scan line, the dot grid) is held for the whole
frame, so two different texts are never blended into one picture.

## Change

- **The address:** `ADDRESS` in `story.js`, the `#url` line in `story.html`, and `qr-data.js` (the QR matrix:
  `QRCode.create(url, { errorCorrectionLevel: "M" })` of the `qrcode` package gives `modules.size` and
  `modules.data`).
- **The acts:** their starts are `A2`, `A3`, `A4` in `story.js`, followed by the timeline; `DUR` is the length. The
  copy is the site's own (the headline, the facts row, the footer's call to action): keep it in step with
  `src/content`.
- **Safe zones:** the top 250 px and the bottom 330 px stay free for the apps' own interface; on Instagram the band
  under the address row (about y 1600 to 1730) is where a link sticker goes.
- **Sizes:** Telegram shows a story video at 720 × 1280 to most viewers and a phone is about 390 points wide, so
  nothing a viewer must read is under 26 px, and the address, the hint and the QR code are far above that.
- The site's rules hold here too (`../CLAUDE.md`): black and white, Persian never letter-spaced and animated by word
  or line, no tool or vendor credited, no way to the owner's GitHub.
