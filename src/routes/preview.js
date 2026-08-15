import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { rewritePageHtml, rewriteCssUrls } from '../previewProxy.js';
import { recordSitePreview } from '../screenRecorder.js';

const FETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 30000;

// Simple in-process TTL cache so the 4 synced device frames don't each
// independently re-fetch the same upstream page/asset within moments of
// each other. Not evicted proactively — stale entries are just skipped
// (and overwritten) on the next read past their TTL.
const pageCache = new Map(); // targetHref -> { expires, html }
const assetCache = new Map(); // targetHref -> { expires, status, contentType, body }

function getFresh(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sendErrorPage(res, status, message) {
  res
    .status(status)
    .set('Content-Type', 'text/html; charset=utf-8')
    .send(`<!doctype html><html><head><meta charset="utf-8"><title>Preview error</title></head>
<body>
<h1>Preview failed to load</h1>
<p>${escapeHtml(message)}</p>
</body></html>`);
}

function parseTargetUrl(raw) {
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

export function createPreviewRouter({ outputRoot } = {}) {
  const router = express.Router();

  router.get('/preview/page', async (req, res) => {
    const target = parseTargetUrl(req.query.url);
    if (!target) {
      sendErrorPage(res, 400, 'Provide a valid http(s) url query param');
      return;
    }
    const cached = getFresh(pageCache, target.href);
    if (cached) {
      res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(cached.html);
      return;
    }
    try {
      const upstream = await fetch(target.href, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const html = await upstream.text();
      const rewritten = await rewritePageHtml(html, target.href);
      pageCache.set(target.href, { expires: Date.now() + CACHE_TTL_MS, html: rewritten });
      res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(rewritten);
    } catch (err) {
      sendErrorPage(res, 502, `Failed to fetch preview target: ${err.message}`);
    }
  });

  router.get('/preview/asset', async (req, res) => {
    const target = parseTargetUrl(req.query.url);
    if (!target) {
      res.status(400).json({ error: 'Provide a valid http(s) url query param' });
      return;
    }
    const cached = getFresh(assetCache, target.href);
    if (cached) {
      res.status(cached.status).set('Content-Type', cached.contentType).send(cached.body);
      return;
    }
    try {
      const upstream = await fetch(target.href, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      if (/text\/css/i.test(contentType)) {
        const css = await upstream.text();
        const rewritten = rewriteCssUrls(css, target.href);
        assetCache.set(target.href, {
          expires: Date.now() + CACHE_TTL_MS,
          status: upstream.status,
          contentType,
          body: rewritten,
        });
        res.status(upstream.status).set('Content-Type', contentType).send(rewritten);
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      assetCache.set(target.href, {
        expires: Date.now() + CACHE_TTL_MS,
        status: upstream.status,
        contentType,
        body: buffer,
      });
      res.status(upstream.status).set('Content-Type', contentType).send(buffer);
    } catch (err) {
      res.status(502).json({ error: `Failed to fetch preview asset: ${err.message}` });
    }
  });

  router.post('/preview/record', async (req, res) => {
    const target = parseTargetUrl(req.body?.url);
    if (!target) {
      res.status(400).json({ error: 'Provide a valid http(s) url in the request body' });
      return;
    }
    if (!outputRoot) {
      res.status(500).json({ error: 'Recording is not configured (missing outputRoot)' });
      return;
    }
    try {
      const recordingsDir = path.join(outputRoot, 'recordings');
      const previewBaseUrl = `${req.protocol}://${req.get('host')}`;
      const { mp4Path, durationMs } = await recordSitePreview({
        url: target.href,
        previewBaseUrl,
        outputDir: recordingsDir,
      });
      const finalName = `${crypto.randomUUID()}.mp4`;
      const finalPath = path.join(recordingsDir, finalName);
      if (path.resolve(mp4Path) !== path.resolve(finalPath)) {
        await fs.rename(mp4Path, finalPath);
      }
      res.status(200).json({ downloadUrl: `/output/recordings/${finalName}`, durationMs });
    } catch (err) {
      res.status(502).json({ error: `Failed to record preview: ${err.message}` });
    }
  });

  return router;
}
