// src/composite.js
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const FRAME_ORDER = ['desktop', 'laptop', 'tablet', 'mobile'];
const CANVAS_WIDTH = 2000;
const CANVAS_HEIGHT = 1200;

// Device frame geometry for the single overlapping "hero mockup" composition
// (monitor + laptop + tablet + phone layered together): a Studio Display up
// top, a MacBook Pro overlapping its bottom-right, and an iPad + iPhone
// cluster overlapping its bottom-left.
//
// Each w:h is the REAL screen aspect ratio of the device it depicts, so the
// site inside is laid out at that device's true viewport shape (the frame's
// ratio is what determines the iframe/screenshot viewport height — see
// public/preview.js scaleFramesToFit):
//
//   desktop  Studio Display 27"   16:9        1.7778  -> 1920x1080
//   laptop   MacBook Pro 14"      3024x1964   1.5397  -> 1440x936
//   tablet   iPad Pro 11"          834x1210   0.6893  ->  768x1114
//   mobile   iPhone 16 Pro         402x874    0.4600  ->  390x848
//
// Positions are hand-tuned within the CANVAS_WIDTH x CANVAS_HEIGHT stage so
// the cluster reads as one balanced composition. public/style.css mirrors
// every value below as a percentage of the same canvas.
const LAYOUT = {
  desktop: { x: 429, y: 74, w: 918, h: 516, z: 1 },
  laptop: { x: 1022, y: 510, w: 874, h: 568, z: 2 },
  tablet: { x: 126, y: 432, w: 363, h: 526, z: 3 },
  mobile: { x: 395, y: 578, w: 206, h: 448, z: 4 },
};

export async function buildComposite(browser, imagesByViewport, outputPath) {
  const entries = FRAME_ORDER.filter((name) => imagesByViewport[name]);
  if (entries.length === 0) {
    throw new Error('buildComposite requires at least one viewport image');
  }

  const dataUrls = {};
  const screenBackgrounds = {};
  for (const name of entries) {
    const buffer = await fs.readFile(imagesByViewport[name]);
    dataUrls[name] = `data:image/png;base64,${buffer.toString('base64')}`;
    screenBackgrounds[name] = await bottomEdgeColor(imagesByViewport[name]);
  }

  const html = renderHtml(entries, dataUrls, screenBackgrounds);

  const page = await browser.newPage({ viewport: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT } });
  try {
    await page.setContent(html);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath });
  } finally {
    await page.close();
  }

  return outputPath;
}

// Average colour of the bottom sliver of a screenshot, used as the screen's
// backdrop. A section shorter than the device's viewport can't fill the
// screen (it's an element screenshot, so its height is whatever the section
// is), and the leftover strip reads as a broken screen if it's left black —
// continuing the page's own background colour instead makes it read as a
// short page, which is what it is.
async function bottomEdgeColor(file) {
  try {
    const image = sharp(file);
    const { width, height } = await image.metadata();
    if (!width || !height) return '#050505';
    const stripHeight = Math.max(1, Math.round(height * 0.02));
    const { data } = await image
      .extract({ left: 0, top: height - stripHeight, width, height: stripHeight })
      .resize(1, 1, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
  } catch {
    // Never fail a whole composite over a cosmetic backdrop.
    return '#050505';
  }
}

function renderHtml(entries, dataUrls, screenBackgrounds = {}) {
  // Draw back-to-front so nearer devices overlap farther ones correctly,
  // regardless of the order sections were detected in.
  const ordered = [...entries].sort((a, b) => LAYOUT[a].z - LAYOUT[b].z);
  const frames = ordered
    .map((name) => frameHtml(name, dataUrls[name], screenBackgrounds[name]))
    .join('\n');

  return `<!doctype html>
<html>
<head>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: ${CANVAS_WIDTH}px;
    height: ${CANVAS_HEIGHT}px;
    background:
      radial-gradient(ellipse 1200px 600px at 30% 20%, rgba(139, 195, 74, 0.10), transparent 60%),
      #101114;
    position: relative;
    font-family: -apple-system, sans-serif;
    overflow: hidden;
  }
  /* Every device sets font-size to its own screen width, so 1em == that
     device's width and all bezel detail below (border thickness, corner
     radius, notch, island, stand) is expressed as a FRACTION of the real
     device — the numbers are taken from Apple's own dimensions. Hard-coded
     px would be wrong at any scale but one: a 42px radius reads as a
     correct iPhone at 400px wide and as an Apple Watch at 80px wide.
     public/style.css uses these exact same em values. */
  .device { position: absolute; }
  .screen { overflow: hidden; background: #050505; }
  /* Fit the capture to the screen's WIDTH and let the height fall where it
     may — anything past the bottom is clipped by .screen.
     NOT object-fit:cover: a section screenshot's height is the section's own
     height, so its ratio rarely matches the device's screen. cover scales by
     whichever axis needs more, which for the common wide-and-short section
     meant scaling by height and cropping the sides — magnifying the page and
     slicing words in half. Horizontal cropping is the one thing this tool
     must never do: the whole point is showing the layout at that width. */
  .screen img { display: block; width: 100%; height: auto; }

  /* Desktop: Studio Display 27" — thin black bezel inside an aluminum
     enclosure edge, on a slim aluminum stand. Bezel is 13mm on a 596mm
     screen (0.022em); no chin (that's an iMac, not a display). */
  .desktop-bezel {
    /* content-box so the screen IS the LAYOUT size and the bezel draws
       outside it, keeping the real screen aspect ratio — public/style.css
       does the same for the live preview. */
    box-sizing: content-box;
    width: 100%; height: 100%;
    border-radius: 0.047em;
    border: 0.022em solid #0a0a0b;
    background: #0a0a0b;
    box-shadow:
      0 0 0 0.016em #c6c8ca,
      0 0.05em 0.09em -0.025em rgba(0, 0, 0, 0.5);
  }
  .desktop-bezel .screen { border-radius: 0.025em; height: 100%; }
  /* Stand: neck tapers outward into a shallow oval foot. */
  .desktop-neck {
    /* +0.060em clears the bezel drawn outside this box: the CSS top edge is
       the border-box top while the height is the CONTENT height, so border adds
       at both top and bottom (2 x 0.022em), plus the aluminium ring
       (0.016em). Without it the stand starts inside the monitor's own edge. */
    position: absolute; left: 50%; top: calc(100% + 0.060em); transform: translateX(-50%);
    width: 0.10em; height: 0.168em;
    border-radius: 0 0 0.012em 0.012em;
    background: linear-gradient(90deg, #9ea1a4, #e8eaeb 40%, #b7babd 72%, #94979a);
  }
  .desktop-foot {
    position: absolute; left: 50%; transform: translateX(-50%);
    top: calc(100% + 0.228em);
    width: 0.40em; height: 0.024em; border-radius: 0.012em;
    background: linear-gradient(180deg, #e2e4e5, #a5a8ab);
    box-shadow: 0 0.016em 0.032em -0.012em rgba(0, 0, 0, 0.5);
  }

  /* Laptop: MacBook Pro 14" — very thin dark bezel (3.5mm on a 312mm
     screen = 0.011em), small camera notch, aluminum base below the lid. */
  .laptop-bezel {
    /* content-box so the screen IS the LAYOUT size and the bezel draws
       outside it, keeping the real screen aspect ratio — public/style.css
       does the same for the live preview. */
    box-sizing: content-box;
    width: 100%; height: 100%;
    border-radius: 0.024em 0.024em 0.006em 0.006em;
    border: 0.014em solid #2e3033;
    background: #2e3033;
    position: relative;
    box-shadow:
      0 0 0 0.005em #4a4d51,
      0 0.05em 0.09em -0.025em rgba(0, 0, 0, 0.5);
  }
  .laptop-bezel .screen { border-radius: 0.012em 0.012em 0.004em 0.004em; height: 100%; position: relative; }
  .laptop-notch {
    position: absolute; top: 0; left: 50%; transform: translateX(-50%);
    width: 0.07em; height: 0.027em; border-radius: 0 0 0.013em 0.013em;
    background: #2e3033; z-index: 2;
  }
  /* Base: the lid sits on it, so it reads slightly wider, with the
     trackpad-lip cutout at front centre. */
  .laptop-deck {
    /* -0.065em = the deck's own 0.032em plus the lid drawn outside the box:
       2 x 0.014em of border plus a 0.005em ring. Without it the base cuts
       into the lid's bottom edge. */
    position: absolute; left: 50%; bottom: -0.065em; transform: translateX(-50%);
    width: 1.05em; height: 0.032em;
    background: linear-gradient(180deg, #d5d7d9 0%, #b6b8ba 55%, #9fa2a5 100%);
    border-radius: 0 0 0.014em 0.014em;
  }
  .laptop-deck::before {
    content: '';
    position: absolute; left: 0; top: 0; width: 100%; height: 0.004em;
    background: rgba(0, 0, 0, 0.28);
  }
  .laptop-deck::after {
    content: '';
    position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
    width: 0.14em; height: 0.008em; border-radius: 0.006em 0.006em 0 0;
    background: #93969a;
  }

  /* Tablet: iPad Pro 11" — uniform aluminum bezel 9mm on a 160mm screen
     (0.056em), and a notably tighter corner radius than an iPhone
     (Apple's displayCornerRadius is 18pt on 834pt wide = 0.022em). */
  .tablet-bezel {
    /* content-box so the screen IS the LAYOUT size and the bezel draws
       outside it, keeping the real screen aspect ratio — public/style.css
       does the same for the live preview. */
    box-sizing: content-box;
    width: 100%; height: 100%;
    border-radius: 0.078em;
    border: 0.056em solid #d5d6d8;
    background: linear-gradient(155deg, #e4e5e7, #c2c4c6);
    position: relative;
    box-shadow:
      0 0 0 0.006em #a9acaf,
      0 0.05em 0.09em -0.025em rgba(0, 0, 0, 0.45);
  }
  .tablet-bezel .screen { border-radius: 0.022em; height: 100%; }
  .tablet-bezel::before {
    content: '';
    position: absolute; top: 0.020em; left: 50%; transform: translateX(-50%);
    width: 0.016em; height: 0.016em; border-radius: 50%;
    background: #23252a;
    z-index: 2;
  }

  /* Phone: iPhone 16 Pro — titanium band, Dynamic Island (125x36pt on a
     402pt screen), home indicator (140x5pt), and Apple's real 55pt screen
     corner radius = 0.137em of the screen width. */
  .mobile-bezel {
    /* content-box so the screen IS the LAYOUT size and the bezel draws
       outside it, keeping the real screen aspect ratio — public/style.css
       does the same for the live preview. */
    box-sizing: content-box;
    width: 100%; height: 100%;
    border-radius: 0.172em;
    border: 0.035em solid #b0a89d;
    background: linear-gradient(155deg, #c3bbb0, #8f877d);
    position: relative;
    box-shadow:
      0 0 0 0.010em #7d766d,
      0 0.05em 0.09em -0.025em rgba(0, 0, 0, 0.5);
  }
  .mobile-bezel .screen { border-radius: 0.137em; height: 100%; position: relative; }
  .mobile-island {
    position: absolute; top: 0.028em; left: 50%; transform: translateX(-50%);
    width: 0.311em; height: 0.0896em; border-radius: 999px;
    background: #050505; box-shadow: 0 0 0 0.002em rgba(255, 255, 255, 0.16); z-index: 2;
  }
  .mobile-home {
    position: absolute; bottom: 0.021em; left: 50%; transform: translateX(-50%);
    width: 0.348em; height: 0.013em; border-radius: 999px;
    background: rgba(255, 255, 255, 0.6); z-index: 2;
  }
</style>
</head>
<body>
  ${frames}
</body>
</html>`;
}

function frameHtml(name, dataUrl, screenBackground) {
  const { x, y, w, h, z } = LAYOUT[name];
  // font-size == the device's own width, so every `em` in the bezel CSS is a
  // fraction of this device (see the style block's opening comment).
  const style = `left:${x}px; top:${y}px; width:${w}px; height:${h}px; z-index:${z}; font-size:${w}px;`;
  const screenStyle = screenBackground ? ` style="background:${screenBackground}"` : '';

  if (name === 'desktop') {
    return `<div class="device" style="${style}">
      <div class="desktop-bezel">
        <div class="screen"${screenStyle}><img src="${dataUrl}" /></div>
      </div>
      <div class="desktop-neck"></div>
      <div class="desktop-foot"></div>
    </div>`;
  }

  if (name === 'laptop') {
    return `<div class="device" style="${style}">
      <div class="laptop-bezel">
        <div class="laptop-notch"></div>
        <div class="screen"${screenStyle}><img src="${dataUrl}" /></div>
      </div>
      <div class="laptop-deck"></div>
    </div>`;
  }

  if (name === 'tablet') {
    return `<div class="device" style="${style}">
      <div class="tablet-bezel"><div class="screen"${screenStyle}><img src="${dataUrl}" /></div></div>
    </div>`;
  }

  // mobile
  return `<div class="device" style="${style}">
    <div class="mobile-bezel">
      <div class="mobile-island"></div>
      <div class="screen"${screenStyle}><img src="${dataUrl}" /></div>
      <div class="mobile-home"></div>
    </div>
  </div>`;
}
