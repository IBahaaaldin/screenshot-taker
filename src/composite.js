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
  desktop: { x: 120, y: 140, w: 980, h: 610, z: 1 },
  laptop: { x: 860, y: 560, w: 760, h: 470, z: 2 },
  tablet: { x: 470, y: 760, w: 300, h: 400, z: 3 },
  mobile: { x: 1620, y: 660, w: 190, h: 400, z: 4 },
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

  /* Desktop monitor: screen + neck + weighted base */
  .desktop-bezel {
    width: 100%; height: 100%;
    border-radius: 14px;
    border: 14px solid #1c1c1e;
    background: #1c1c1e;
  }
  .desktop-bezel .screen { border-radius: 3px; height: 100%; }
  .desktop-neck {
    position: absolute; left: 50%; bottom: -46px; transform: translateX(-50%);
    width: 90px; height: 50px;
    background: linear-gradient(180deg, #232326, #17171a);
    clip-path: polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%);
  }
  .desktop-base {
    position: absolute; left: 50%; bottom: -60px; transform: translateX(-50%);
    width: 260px; height: 16px; border-radius: 999px;
    background: linear-gradient(180deg, #29292c, #131315);
  }

  /* Laptop: screen bezel + angled keyboard deck */
  .laptop-bezel {
    width: 100%; height: 100%;
    border-radius: 12px 12px 3px 3px;
    border: 12px solid #1e1e20;
    border-bottom-width: 6px;
    background: #1e1e20;
  }
  .laptop-bezel .screen { border-radius: 2px; height: 100%; }
  .laptop-deck {
    position: absolute; left: 50%; bottom: -26px; transform: translateX(-50%);
    width: 116%; height: 26px;
    background: linear-gradient(180deg, #313134, #1a1a1c);
    border-radius: 0 0 10px 10px;
  }
  .laptop-deck::after {
    content: '';
    position: absolute; left: 50%; top: 0; transform: translateX(-50%);
    width: 90px; height: 6px; border-radius: 0 0 6px 6px;
    background: #0e0e0f;
  }

  /* Tablet: thick uniform bezel + camera dot */
  .tablet-bezel {
    width: 100%; height: 100%;
    border-radius: 26px;
    border: 16px solid #1e1e20;
    background: #1e1e20;
    position: relative;
  }
  .tablet-bezel .screen { border-radius: 4px; height: 100%; }
  .tablet-bezel::before {
    content: '';
    position: absolute; top: -9px; left: 50%; transform: translateX(-50%);
    width: 6px; height: 6px; border-radius: 50%;
    background: #3a3a3d;
  }

  /* Phone: thick bezel + notch + home indicator */
  .mobile-bezel {
    width: 100%; height: 100%;
    border-radius: 34px;
    border: 12px solid #1e1e20;
    background: #1e1e20;
    position: relative;
  }
  .mobile-bezel .screen { border-radius: 20px; height: 100%; position: relative; }
  .mobile-notch {
    position: absolute; top: 0; left: 50%; transform: translateX(-50%);
    width: 76px; height: 22px; border-radius: 0 0 14px 14px;
    background: #0d0d0e; z-index: 2;
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
      <div class="desktop-neck"></div>
      <div class="desktop-base"></div>
    </div>`;
  }

  if (name === 'laptop') {
    return `<div class="device" style="${style}">
      <div class="laptop-bezel"><div class="screen"><img src="${dataUrl}" /></div></div>
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
      <div class="mobile-notch"></div>
      <div class="screen"><img src="${dataUrl}" /></div>
      <div class="mobile-home"></div>
    </div>
  </div>`;
}
