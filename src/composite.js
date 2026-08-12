// src/composite.js
import fs from 'node:fs/promises';
import path from 'node:path';

const FRAME_ORDER = ['desktop', 'laptop', 'tablet', 'mobile'];
const CANVAS_WIDTH = 2000;
const CANVAS_HEIGHT = 1200;

export async function buildComposite(browser, imagesByViewport, outputPath) {
  const entries = FRAME_ORDER.filter((name) => imagesByViewport[name]);
  if (entries.length === 0) {
    throw new Error('buildComposite requires at least one viewport image');
  }

  const dataUris = {};
  for (const name of entries) {
    const buf = await fs.readFile(imagesByViewport[name]);
    dataUris[name] = `data:image/png;base64,${buf.toString('base64')}`;
  }

  const html = renderHtml(entries, dataUris);

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

function renderHtml(entries, dataUris) {
  const frames = entries
    .map((name) => frameHtml(name, dataUris[name]))
    .join('\n');

  return `<!doctype html>
<html>
<head>
<style>
  body { margin: 0; width: ${CANVAS_WIDTH}px; height: ${CANVAS_HEIGHT}px; background: #0a0a0a; display: flex; align-items: center; justify-content: center; gap: 40px; font-family: sans-serif; }
  .frame { display: flex; flex-direction: column; align-items: center; }
  .bezel { border: 10px solid #2a2a2a; border-radius: 14px; background: #111; box-shadow: 0 20px 40px rgba(0,0,0,0.5); overflow: hidden; }
  .bezel img { display: block; max-width: 100%; max-height: 100%; object-fit: cover; }
  .label { color: #8bc34a; margin-top: 12px; font-size: 18px; text-transform: capitalize; }
</style>
</head>
<body>
  ${frames}
</body>
</html>`;
}

function frameHtml(name, dataUri) {
  const dims = {
    desktop: { w: 560, h: 350 },
    laptop: { w: 460, h: 300 },
    tablet: { w: 300, h: 400 },
    mobile: { w: 200, h: 420 },
  }[name];

  return `<div class="frame">
    <div class="bezel" style="width:${dims.w}px;height:${dims.h}px;">
      <img src="${dataUri}" />
    </div>
    <div class="label">${name}</div>
  </div>`;
}
