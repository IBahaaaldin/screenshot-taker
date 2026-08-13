import express from 'express';
import path from 'node:path';
import { readQueue, writeQueue, createQueueItem, withQueueLock } from '../postQueue.js';
import { postQueueItem } from '../postingService.js';

export function createPostQueueRouter({ outputRoot, deps = {} }) {
  const router = express.Router();
  const queueFilePath = path.join(outputRoot, 'post-queue.json');

  router.post('/queue', async (req, res) => {
    try {
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

      if (kind === 'carousel' && images.length > 10) {
        res.status(400).json({
          error: 'Carousel posts support at most 10 images',
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
      await withQueueLock(queueFilePath, async () => {
        const queue = await readQueue(queueFilePath);
        queue.items.push(item);
        await writeQueue(queueFilePath, queue);
      });

      const result = await postQueueItem(item.id, {
        igUserId,
        accessToken,
        outputRoot,
        queueFilePath,
        ...deps,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal error: ' + err.message });
    }
  });

  router.get('/queue', async (req, res) => {
    try {
      const queue = await readQueue(queueFilePath);
      res.json({ items: [...queue.items].reverse() });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal error: ' + err.message });
    }
  });

  return router;
}
