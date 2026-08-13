import path from 'node:path';
import { readQueue, writeQueue, countPostsInLast24h } from './postQueue.js';
import { postSingleImage, postCarousel } from './instagram.js';
import { startTunnel } from './tunnel.js';
import { startLocalServer } from './localServer.js';

// The scheduler and the manual-post route both call postQueueItem in the same
// process, and each call does a slow (tunnel + Graph API) read-modify-write of
// the whole post-queue.json file. If two calls overlapped, the second call's
// finally-block write could stomp on the first call's write with a stale
// in-memory snapshot — including reverting an already-`posted` item back to
// `queued`, which could then get posted to Instagram a second time. Chaining
// every call onto a shared promise serializes the whole read-modify-write
// cycle so no two calls' file I/O can interleave.
let writeLock = Promise.resolve();

export async function postQueueItem(itemId, options) {
  const run = () => postQueueItemImpl(itemId, options);
  const result = writeLock.then(run, run);
  writeLock = result.then(
    () => {},
    () => {}
  );
  return result;
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
