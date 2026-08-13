import path from 'node:path';
import { readQueue, writeQueue, countPostsInLast24h, withQueueLock } from './postQueue.js';
import { postSingleImage, postCarousel } from './instagram.js';
import { startTunnel } from './tunnel.js';
import { startLocalServer } from './localServer.js';

// The scheduler, the manual "Post now" flow, and any other appender of
// post-queue.json (the create-queue-item route, autoQueueManifest) all share
// the SAME lock — withQueueLock, keyed by queue file path, from postQueue.js.
// It is the only lock in the system: every read-modify-write of the queue
// file, whether it's appending a new item or posting an existing one, is
// serialized through it so none of those operations can interleave and
// silently clobber each other's writes.
export async function postQueueItem(itemId, options) {
  return withQueueLock(options.queueFilePath, () => postQueueItemImpl(itemId, options));
}

async function postQueueItemImpl(
  itemId,
  {
    igUserId,
    accessToken,
    outputRoot,
    queueFilePath,
    postSingleImageFn = postSingleImage,
    postCarouselFn = postCarousel,
    startTunnelFn = startTunnel,
    startLocalServerFn = startLocalServer,
  }
) {
  const queue = await readQueue(queueFilePath);
  const item = queue.items.find((i) => i.id === itemId);
  if (!item) {
    throw new Error(`Queue item ${itemId} not found`);
  }

  // Now that we're inside the shared lock and have a fresh read of the queue,
  // re-check status before doing anything else. If two calls ever targeted
  // the same item id, only the first (now properly serialized) call sees
  // 'queued' here; a second call sees whatever the first call already wrote
  // (posting/posted/failed) and must no-op rather than post again.
  if (item.status !== 'queued') {
    return item;
  }

  if (countPostsInLast24h(queue) >= 25) {
    item.status = 'failed';
    item.error = 'Instagram rate limit reached (25 posts/24h) — try again later.';
    await writeQueue(queueFilePath, queue);
    return item;
  }

  item.status = 'posting';
  await writeQueue(queueFilePath, queue);

  let tunnel;
  let localServer;
  try {
    localServer = await startLocalServerFn(outputRoot);
    const localPort = new URL(localServer.url).port;
    tunnel = await startTunnelFn(localPort);
    const imageUrls = item.images.map((imagePath) => toPublicUrl(imagePath, outputRoot, tunnel.url));

    const igMediaId =
      item.kind === 'carousel'
        ? await postCarouselFn({ igUserId, accessToken, imageUrls, caption: item.caption })
        : await postSingleImageFn({ igUserId, accessToken, imageUrl: imageUrls[0], caption: item.caption });

    item.status = 'posted';
    item.igMediaId = igMediaId;
    item.postedAt = new Date().toISOString();
    item.error = null;
  } catch (err) {
    item.status = 'failed';
    item.error = err.message;
  } finally {
    if (tunnel) await tunnel.close();
    if (localServer) await localServer.close();
    await writeQueue(queueFilePath, queue);
  }

  return item;
}

function toPublicUrl(absoluteImagePath, outputRoot, tunnelUrl) {
  const relative = path.relative(outputRoot, absoluteImagePath).split(path.sep).join('/');
  return `${tunnelUrl}/${relative}`;
}
