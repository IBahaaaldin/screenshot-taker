import express from 'express';
import { rewritePageHtml, rewriteCssUrls } from '../previewProxy.js';

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

export function createPreviewRouter() {
  const router = express.Router();

  router.get('/preview/page', async (req, res) => {
    const target = parseTargetUrl(req.query.url);
    if (!target) {
      res.status(400).json({ error: 'Provide a valid http(s) url query param' });
      return;
    }
    try {
      const upstream = await fetch(target.href);
      const html = await upstream.text();
      const rewritten = await rewritePageHtml(html, target.href);
      res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(rewritten);
    } catch (err) {
      res.status(502).json({ error: `Failed to fetch preview target: ${err.message}` });
    }
  });

  router.get('/preview/asset', async (req, res) => {
    const target = parseTargetUrl(req.query.url);
    if (!target) {
      res.status(400).json({ error: 'Provide a valid http(s) url query param' });
      return;
    }
    try {
      const upstream = await fetch(target.href);
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      if (/text\/css/i.test(contentType)) {
        const css = await upstream.text();
        res.status(upstream.status).set('Content-Type', contentType).send(rewriteCssUrls(css, target.href));
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status).set('Content-Type', contentType).send(buffer);
    } catch (err) {
      res.status(502).json({ error: `Failed to fetch preview asset: ${err.message}` });
    }
  });

  return router;
}
