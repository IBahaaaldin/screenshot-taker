import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';
import { runPipeline } from '../pipeline.js';
import { startLocalServer } from '../localServer.js';

export function createRunRouter({ outputRoot, runs }) {
  const router = express.Router();

  router.post('/run', async (req, res) => {
    const { url, localFolder, mode, selectors = [], siteName } = req.body || {};
    if (!siteName || !mode || (!url && !localFolder) || (url && localFolder)) {
      res.status(400).json({ error: 'Provide siteName, mode, and exactly one of url/localFolder' });
      return;
    }

    const runId = crypto.randomUUID();
    const outputDir = path.join(outputRoot, siteName);
    runs.set(runId, { status: 'running', events: [], manifest: null, outputDir });

    res.json({ runId });

    executeRun({ runId, url, localFolder, mode, selectors, siteName, outputRoot, runs }).catch((err) => {
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
        if (run.manifest) {
          res.write(`data: ${JSON.stringify({ type: 'manifest-ready', manifest: run.manifest })}\n\n`);
        }
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
      res.status(409).json({ error: `Run is not finished yet (status: ${run.status})` });
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

async function executeRun({ runId, url, localFolder, mode, selectors, siteName, outputRoot, runs }) {
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
  } finally {
    if (localServer) await localServer.close();
  }
}
