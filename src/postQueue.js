import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// All mutations of a given post-queue.json (appends from the create-queue-item
// route, autoQueueManifest's bulk append, and postingService's posting logic)
// must go through this shared lock, keyed by queue file path. Without it, two
// overlapping read-modify-write cycles on the same file can race: whichever
// call's in-memory snapshot is stale by the time it writes will silently
// clobber the other call's changes (a lost append, or worse, a reverted
// status). Keying by path costs nothing today (there's only one queue file
// per outputRoot) and is correct if that ever changes.
const queueLocks = new Map();

export async function withQueueLock(queueFilePath, fn) {
  const prior = queueLocks.get(queueFilePath) ?? Promise.resolve();
  const run = () => fn();
  const result = prior.then(run, run);
  // Always leave the map holding a settled-tracking promise so a rejection
  // from this holder never wedges the lock for the next one.
  queueLocks.set(
    queueFilePath,
    result.then(
      () => {},
      () => {}
    )
  );
  return result;
}

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
  const tmpPath = `${queueFilePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tmpPath, JSON.stringify(queue, null, 2), 'utf8');
  try {
    await fs.rename(tmpPath, queueFilePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw err;
  }
}

export function createQueueItem({ siteName, pageUrl, kind, images, caption, scheduledFor }) {
  return {
    id: crypto.randomUUID(),
    siteName,
    pageUrl,
    kind,
    images,
    caption,
    status: 'queued',
    createdAt: new Date().toISOString(),
    scheduledFor: scheduledFor ?? new Date().toISOString(),
    postedAt: null,
    igMediaId: null,
    error: null,
  };
}

export function nextScheduledSlot(queue, intervalHours, now = new Date()) {
  const pendingTimes = queue.items
    .filter((item) => item.status === 'queued')
    .map((item) => Date.parse(item.scheduledFor))
    .filter((t) => Number.isFinite(t));

  if (pendingTimes.length === 0) {
    return now.toISOString();
  }

  const latest = Math.max(...pendingTimes);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  return new Date(latest + intervalMs).toISOString();
}

export function isDue(item, now = new Date()) {
  if (item.status !== 'queued') return false;
  const scheduledMs = Date.parse(item.scheduledFor);
  return Number.isFinite(scheduledMs) && scheduledMs <= now.getTime();
}

export function countPostsInLast24h(queue, now = Date.now()) {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return queue.items.filter(
    (item) => item.status === 'posted' && item.postedAt && Date.parse(item.postedAt) >= cutoff
  ).length;
}
