import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunRouter } from './routes/run.js';
import { createPostQueueRouter } from './routes/postQueue.js';
import { loadEnvFile } from './env.js';
import { startScheduler } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnvFile(path.join(__dirname, '..', '.env'));

export function createApp({ outputRoot = path.join(__dirname, '..', 'output'), postQueueDeps = {} } = {}) {
  const app = express();
  const runs = new Map();

  app.use(express.json());
  app.use('/api', createRunRouter({ outputRoot, runs }));
  app.use('/api', createPostQueueRouter({ outputRoot, deps: postQueueDeps }));
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
