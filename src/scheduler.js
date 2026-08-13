import path from 'node:path';
import { readQueue, isDue } from './postQueue.js';
import { postQueueItem } from './postingService.js';

export async function runSchedulerTick({
  outputRoot,
  igUserId,
  accessToken,
  now = new Date(),
  postQueueItemFn = postQueueItem,
}) {
  const queueFilePath = path.join(outputRoot, 'post-queue.json');
  const queue = await readQueue(queueFilePath);
  const due = queue.items.find((item) => isDue(item, now));
  if (!due) {
    return null;
  }
  return postQueueItemFn(due.id, { igUserId, accessToken, outputRoot, queueFilePath });
}

export function startScheduler({
  outputRoot,
  igUserId,
  accessToken,
  intervalMs = 15 * 60 * 1000,
  runTickFn = runSchedulerTick,
}) {
  const timer = setInterval(() => {
    runTickFn({ outputRoot, igUserId, accessToken }).catch((err) => {
      console.error('[scheduler] tick failed:', err.message);
    });
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
