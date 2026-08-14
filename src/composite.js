// src/composite.js
import fs from 'node:fs/promises';
import path from 'node:path';

const FRAME_ORDER = ['desktop', 'laptop', 'tablet', 'mobile'];
const CANVAS_WIDTH = 2000;
const CANVAS_HEIGHT = 1200;

// Device frame geometry for the single overlapping "hero mockup" composition
// (monitor + laptop + tablet + phone layered together, amiresponsive.com
// style) instead of separate side-by-side labeled boxes. Values are hand
// -tuned pixel positions/sizes within the CANVAS_WIDTH x CANVAS_HEIGHT stage.
const LAYOUT = {
  desktop: { x: 480, y: 120, w: 1000, h: 620, z: 1 },
  laptop: { x: 1120, y: 580, w: 760, h: 470, z: 2 },
  tablet: { x: 340, y: 680, w: 320, h: 430, z: 3 },
  mobile: { x: 640, y: 760, w: 200, h: 420, z: 4 },
};

export async function buildComposite(browser, imagesByViewport, outputPath) {
  const entries = FRAME_ORDER.filter((name) => imagesByViewport[name]);
  if (entries.length === 0) {
    throw new Error('buildComposite requires at least one viewport image');
  }

  const dataUrls = {};
  for (const name of entries) {
    const buffer = await fs.readFile(imagesByViewport[name]);
    dataUrls[name] = `data:image/png;base64,${buffer.toString('base64')}`;
  }

  const html = renderHtml(entries, dataUrls);

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

function renderHtml(entries, dataUrls) {
  // Draw back-to-front so nearer devices overlap farther ones correctly,
  // regardless of the order sections were detected in.
  const ordered = [...entries].sort((a, b) => LAYOUT[a].z - LAYOUT[b].z);
  const frames = ordered.map((name) => frameHtml(name, dataUrls[name])).join('\n');

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
      #0a0a0a;
    position: relative;
    font-family: -apple-system, sans-serif;
    overflow: hidden;
  }
  .device { position: absolute; filter: drop-shadow(0 30px 50px rgba(0,0,0,0.55)); }
  .screen { overflow: hidden; background: #050505; }
  .screen img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }

  /* Desktop: Apple Studio Display — near-borderless screen, no chin,
     single center arm mount, small flat foot. */
  .desktop-bezel {
    width: 100%; height: 100%;
    border-radius: 16px;
    border: 7px solid #d9dadc;
    background: linear-gradient(155deg, #eceeef, #cfd1d3);
  }
  .desktop-bezel .screen { border-radius: 9px; height: 100%; }
  .desktop-arm {
    position: absolute; left: 50%; bottom: -64px; transform: translateX(-50%);
    width: 46px; height: 64px;
    background: linear-gradient(90deg, #b9bbbd, #e7e8ea 45%, #b9bbbd);
    border-radius: 4px;
  }
  .desktop-base {
    position: absolute; left: 50%; bottom: -76px; transform: translateX(-50%);
    width: 220px; height: 14px; border-radius: 7px;
    background: linear-gradient(180deg, #dcdddf, #b6b8ba);
  }

  /* Laptop: MacBook Pro — screen notch, thin silver bezel, rounded top
     corners, aluminum keyboard deck with a hinge seam. */
  .laptop-bezel {
    width: 100%; height: 100%;
    border-radius: 18px 18px 4px 4px;
    border: 9px solid #2b2c2e;
    border-bottom-width: 3px;
    background: #2b2c2e;
    position: relative;
  }
  .laptop-bezel .screen { border-radius: 10px 10px 2px 2px; height: 100%; position: relative; }
  .laptop-notch {
    position: absolute; top: 0; left: 50%; transform: translateX(-50%);
    width: 13%; height: 20px; border-radius: 0 0 10px 10px;
    background: #050505; z-index: 2;
  }
  .laptop-deck {
    position: absolute; left: 50%; bottom: -22px; transform: translateX(-50%);
    width: 122%; height: 22px;
    background: linear-gradient(180deg, #e4e5e7, #b9bbbd);
    border-radius: 0 0 14px 14px;
  }
  .laptop-deck::before {
    content: '';
    position: absolute; left: 0; top: 0; width: 100%; height: 3px;
    background: linear-gradient(180deg, rgba(0,0,0,0.25), transparent);
  }
  .laptop-deck::after {
    content: '';
    position: absolute; left: 50%; top: 5px; transform: translateX(-50%);
    width: 15%; height: 5px; border-radius: 3px;
    background: #9a9c9e;
  }

  /* Tablet: iPad Pro — ultra-thin uniform bezel, large corner radius,
     brushed-aluminum edge, centered camera. */
  .tablet-bezel {
    width: 100%; height: 100%;
    border-radius: 22px;
    border: 8px solid #d3d4d6;
    background: linear-gradient(155deg, #e7e8ea, #c3c5c7);
    position: relative;
  }
  .tablet-bezel .screen { border-radius: 14px; height: 100%; }
  .tablet-bezel::before {
    content: '';
    position: absolute; top: 3px; left: 50%; transform: translateX(-50%);
    width: 5px; height: 5px; border-radius: 50%;
    background: #16171a; box-shadow: 0 0 0 2px rgba(0,0,0,0.08);
    z-index: 2;
  }

  /* Phone: iPhone — Dynamic Island, titanium frame, large corner radius,
     bottom home indicator. */
  .mobile-bezel {
    width: 100%; height: 100%;
    border-radius: 42px;
    border: 6px solid #948d84;
    background: linear-gradient(155deg, #a79f95, #857d73);
    position: relative;
  }
  .mobile-bezel .screen { border-radius: 36px; height: 100%; position: relative; }
  .mobile-island {
    position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
    width: 34%; height: 20px; border-radius: 999px;
    background: #050505; z-index: 2;
  }
  .mobile-home {
    position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
    width: 90px; height: 4px; border-radius: 999px;
    background: rgba(255,255,255,0.55); z-index: 2;
  }
</style>
</head>
<body>
  ${frames}
</body>
</html>`;
}

function frameHtml(name, dataUrl) {
  const { x, y, w, h, z } = LAYOUT[name];
  const style = `left:${x}px; top:${y}px; width:${w}px; height:${h}px; z-index:${z};`;

  if (name === 'desktop') {
    return `<div class="device" style="${style}">
      <div class="desktop-bezel"><div class="screen"><img src="${dataUrl}" /></div></div>
      <div class="desktop-arm"></div>
      <div class="desktop-base"></div>
    </div>`;
  }

  if (name === 'laptop') {
    return `<div class="device" style="${style}">
      <div class="laptop-bezel">
        <div class="laptop-notch"></div>
        <div class="screen"><img src="${dataUrl}" /></div>
      </div>
      <div class="laptop-deck"></div>
    </div>`;
  }

  if (name === 'tablet') {
    return `<div class="device" style="${style}">
      <div class="tablet-bezel"><div class="screen"><img src="${dataUrl}" /></div></div>
    </div>`;
  }

  // mobile
  return `<div class="device" style="${style}">
    <div class="mobile-bezel">
      <div class="mobile-island"></div>
      <div class="screen"><img src="${dataUrl}" /></div>
      <div class="mobile-home"></div>
    </div>
  </div>`;
}
