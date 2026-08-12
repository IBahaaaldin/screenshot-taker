import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunRouter } from './routes/run.js';
import { createPostQueueRouter } from './routes/postQueue.js';
import { loadEnvFile } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnvFile(path.join(__dirname, '..', '.env'));

export function createApp({ outputRoot = path.join(__dirname, '..', 'output') } = {}) {
  const app = express();
  const runs = new Map();

  app.use(express.json());
  app.use('/api', createRunRouter({ outputRoot, runs }));
  app.use('/api', createPostQueueRouter({ outputRoot }));
  app.use('/output', express.static(outputRoot));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, '127.0.0.1', () => console.log(`Screenshot Taker running on http://localhost:${port}`));
}
