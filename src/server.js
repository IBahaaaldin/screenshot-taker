import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunRouter } from './routes/run.js';
import { createPostQueueRouter } from './routes/postQueue.js';
import { createPreviewRouter } from './routes/preview.js';
import { loadEnvFile } from './env.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnvFile(path.join(__dirname, '..', '.env'));

export function createApp({
  outputRoot = path.join(__dirname, '..', 'output'),
  postQueueDeps = {},
  port = process.env.PORT || 3000,
} = {}) {
  const app = express();
  const runs = new Map();
  // Fixed to the server's own bound origin rather than derived from the
  // request (req.protocol/req.get('host')), which is attacker-controlled
  // via a forged Host header and would let a request launch a real,
  // non-sandboxed Chromium navigation to an arbitrary origin.
  const previewBaseUrl = `http://127.0.0.1:${port}`;

  app.use(express.json());
  app.use('/api', createRunRouter({ outputRoot, runs }));
  app.use('/api', createPostQueueRouter({ outputRoot, deps: postQueueDeps }));
  app.use('/api', createPreviewRouter({ outputRoot, previewBaseUrl }));
  app.use('/output', express.static(outputRoot));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  const outputRoot = path.join(__dirname, '..', 'output');
  const igUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (igUserId && accessToken) {
    startScheduler({ outputRoot, igUserId, accessToken });
    console.log('Instagram scheduler started (posts due queue items automatically).');
  }
  app.listen(port, '127.0.0.1', () =>
    console.log(`Screenshot Taker running on http://localhost:${port}`)
  );
}
