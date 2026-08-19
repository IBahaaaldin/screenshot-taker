import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
const race = Promise.race([
  page.goto('https://ibahaaaldin.github.io/screenshot-taker/', { waitUntil: 'load', timeout: 8000 }).then(() => 'loaded'),
  new Promise((_, rej) => setTimeout(() => rej(new Error('hard-timeout-20s')), 20000)),
]);
try {
  console.log(await race);
} catch (e) {
  console.log('FAILED:', e.message);
}
await browser.close();
