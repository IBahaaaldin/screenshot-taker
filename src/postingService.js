import path from 'node:path';
import { readQueue, writeQueue, countPostsInLast24h } from './postQueue.js';
import { postSingleImage, postCarousel } from './instagram.js';
import { startTunnel } from './tunnel.js';

export async function postQueueItem(
  itemId,
  {
    igUserId,
    accessToken,
    outputRoot,
    port,
    queueFilePath,
    postSingleImageFn = postSingleImage,
    postCarouselFn = postCarousel,
    startTunnelFn = startTunnel,
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
  try {
    tunnel = await startTunnelFn(port);
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
    await writeQueue(queueFilePath, queue);
  }

  return item;
}

function toPublicUrl(absoluteImagePath, outputRoot, tunnelUrl) {
  const relative = path.relative(outputRoot, absoluteImagePath).split(path.sep).join('/');
  return `${tunnelUrl}/output/${relative}`;
}
