import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import { runPipeline } from '../pipeline.js';
import { startLocalServer } from '../localServer.js';
import { generateCaption } from '../caption.js';
import { readQueue, writeQueue, createQueueItem, nextScheduledSlot } from '../postQueue.js';

export function createRunRouter({ outputRoot, runs }) {
  const router = express.Router();

  const SITE_NAME_RE = /^[A-Za-z0-9._-]+$/;
  const VALID_MODES = new Set(['auto', 'selectors', 'full-page']);

  router.post('/run', async (req, res) => {
    const { url, localFolder, mode, selectors = [], siteName, autoPost = false } = req.body || {};
    if (!siteName || !mode || (!url && !localFolder) || (url && localFolder)) {
      res.status(400).json({ error: 'Provide siteName, mode, and exactly one of url/localFolder' });
      return;
    }
    if (!SITE_NAME_RE.test(siteName)) {
      res.status(400).json({ error: 'siteName must contain only letters, numbers, dots, underscores, and hyphens' });
      return;
    }
    if (siteName === '.' || siteName === '..' || path.basename(siteName) !== siteName) {
      res.status(400).json({ error: 'siteName must not be a path traversal or path-separator segment' });
      return;
    }
    if (!VALID_MODES.has(mode)) {
      res.status(400).json({ error: "mode must be one of 'auto', 'selectors', or 'full-page'" });
      return;
    }

    const runId = crypto.randomUUID();
    const outputDir = path.join(outputRoot, siteName);
    runs.set(runId, { status: 'running', events: [], manifest: null, outputDir });

    res.json({ runId });

    executeRun({ runId, url, localFolder, mode, selectors, siteName, outputRoot, runs, autoPost }).catch((err) => {
      const run = runs.get(runId);
      run.status = 'error';
      run.events.push({ type: 'error', message: err.message });
    });
  });

  router.get('/progress/:runId', async (req, res) => {
    const run = runs.get(req.params.runId);
    if (!run) {
      res.status(404).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    let sent = 0;
    const interval = setInterval(() => {
      while (sent < run.events.length) {
        const event = run.events[sent++];
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (run.status !== 'running' && sent >= run.events.length) {
        res.write(`data: ${JSON.stringify({ type: 'manifest-ready', manifest: run.manifest || null })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    }, 100);

    req.on('close', () => clearInterval(interval));
  });

  router.get('/download/:runId', (req, res) => {
    const run = runs.get(req.params.runId);
    if (!run) {
      res.status(404).end();
      return;
    }
    if (run.status !== 'done') {
      const message = run.status === 'error'
        ? 'Run failed, no output to download'
        : `Run is not finished yet (status: ${run.status})`;
      res.status(409).json({ error: message });
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.runId}.zip"`);
    const archive = archiver('zip');
    archive.on('error', (err) => {
      console.error(`Archive error for run ${req.params.runId}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive' });
      } else {
        res.destroy();
      }
    });
    archive.pipe(res);
    archive.directory(run.outputDir, false);
    archive.finalize();
  });

  return router;
}

async function executeRun({ runId, url, localFolder, mode, selectors, siteName, outputRoot, runs, autoPost }) {
  const run = runs.get(runId);
  let localServer = null;
  let startUrl = url;

  if (localFolder) {
    localServer = await startLocalServer(localFolder);
    startUrl = `${localServer.url}/index.html`;
  }

  try {
    const manifest = await runPipeline(
      { startUrl, mode, selectors, siteName, outputRoot },
      (event) => run.events.push(event)
    );
    run.manifest = manifest;
    run.status = 'done';

    if (autoPost) {
      await autoQueueManifest(manifest, { outputRoot, onProgress: (event) => run.events.push(event) });
    }
  } finally {
    if (localServer) await localServer.close();
  }
}

async function autoQueueManifest(manifest, { outputRoot, onProgress }) {
  const igUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const accessToken = process.env.IG_ACCESS_TOKEN;
  if (!igUserId || !accessToken) {
    onProgress({
      type: 'auto-post-skipped',
      message: 'Instagram is not configured — set IG_BUSINESS_ACCOUNT_ID and IG_ACCESS_TOKEN in .env to enable auto-posting',
    });
    return;
  }

  const intervalHours = Number(process.env.SCHEDULE_INTERVAL_HOURS) || 24;
  const queueFilePath = path.join(outputRoot, 'post-queue.json');
  const queue = await readQueue(queueFilePath);

  for (const page of manifest.pages) {
    for (const section of page.sections) {
      if (!section.composite) continue;
      const caption = generateCaption({ siteName: manifest.site, pageUrl: page.url, slug: section.slug });
      const scheduledFor = nextScheduledSlot(queue, intervalHours);
      const item = createQueueItem({
        siteName: manifest.site,
        pageUrl: page.url,
        kind: 'single',
        images: [section.composite],
        caption,
        scheduledFor,
      });
      queue.items.push(item);
      onProgress({ type: 'auto-post-queued', message: `Queued ${section.slug} for ${scheduledFor}` });
    }
  }

  await writeQueue(queueFilePath, queue);
}
