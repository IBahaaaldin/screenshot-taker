import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export async function readQueue(queueFilePath) {
  try {
    const raw = await fs.readFile(queueFilePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return { items: [] };
    throw err;
  }
}

export async function writeQueue(queueFilePath, queue) {
  await fs.mkdir(path.dirname(queueFilePath), { recursive: true });
  await fs.writeFile(queueFilePath, JSON.stringify(queue, null, 2), 'utf8');
}

export function createQueueItem({ siteName, pageUrl, kind, images, caption }) {
  return {
    id: crypto.randomUUID(),
    siteName,
    pageUrl,
    kind,
    images,
    caption,
    status: 'queued',
    createdAt: new Date().toISOString(),
    postedAt: null,
    igMediaId: null,
    error: null,
  };
}

export function countPostsInLast24h(queue, now = Date.now()) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return queue.items.filter(
    (item) => item.status === 'posted' && item.postedAt && Date.parse(item.postedAt) >= cutoff
  ).length;
}
