import path from 'node:path';
import os from 'node:os';
import { runPipeline } from './src/pipeline.js';

const outputRoot = path.join(os.homedir(), 'Desktop', 'screenshot-taker-self-promo');
const manifest = await runPipeline({
  startUrl: 'https://ibahaaaldin.github.io/screenshot-taker/',
  mode: 'auto',
  siteName: 'self-promo',
  outputRoot,
  maxPages: 10,
}, (evt) => console.log(`[${evt.type}] ${evt.message}`));

console.log('\npages:', manifest.pages.length);
for (const p of manifest.pages) console.log(' ', p.url, '-', p.sections.length, 'sections');
