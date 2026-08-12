import express from 'express';
import path from 'node:path';
import { readQueue, writeQueue, createQueueItem } from '../postQueue.js';
import { postQueueItem } from '../postingService.js';

export function createPostQueueRouter({ outputRoot, deps = {} }) {
  const router = express.Router();
  const queueFilePath = path.join(outputRoot, 'post-queue.json');

  router.post('/queue', async (req, res) => {
    const { siteName, pageUrl, kind, images, caption } = req.body || {};
    if (
      !siteName ||
      !pageUrl ||
      !kind ||
      !Array.isArray(images) ||
      images.length === 0 ||
      !caption
    ) {
      res.status(400).json({
        error: 'Provide siteName, pageUrl, kind, images (non-empty array), and caption',
      });
      return;
    }

    const igUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
    const accessToken = process.env.IG_ACCESS_TOKEN;
    if (!igUserId || !accessToken) {
      res.status(400).json({
        error: 'Instagram is not configured — set IG_BUSINESS_ACCOUNT_ID and IG_ACCESS_TOKEN in .env',
      });
      return;
    }

    const item = createQueueItem({ siteName, pageUrl, kind, images, caption });
    const queue = await readQueue(queueFilePath);
    queue.items.push(item);
    await writeQueue(queueFilePath, queue);

    const result = await postQueueItem(item.id, {
      igUserId,
      accessToken,
      outputRoot,
      port: req.socket.localPort,
      queueFilePath,
      ...deps,
    });
    res.json(result);
  });

  router.get('/queue', async (req, res) => {
    const queue = await readQueue(queueFilePath);
    res.json({ items: [...queue.items].reverse() });
  });

  return router;
}
