import express from 'express';
import { generateCaption, generateCarouselCaption } from '../caption.js';

// The caption modal used to draft captions with its own reimplementation of
// generateCaption's logic (public/app.js's old draftCaption) — a second copy
// that had drifted from the real one: no hashtag/hook variety, and it never
// picked up the siteName/heading collision fix. This route lets the UI draft
// from the same tested functions autoQueueManifest uses, so what a user sees
// in the modal is what auto-posting would actually produce.
export function createCaptionRouter() {
  const router = express.Router();

  router.get('/caption/draft', (req, res) => {
    const { siteName, pageUrl, kind, slug, slideCount } = req.query;
    if (!siteName || !pageUrl) {
      res.status(400).json({ error: 'Provide siteName and pageUrl' });
      return;
    }

    try {
      if (kind === 'carousel') {
        const count = Number(slideCount);
        const caption = generateCarouselCaption({ siteName, pageUrl, slideCount: count });
        res.status(200).json({ caption });
        return;
      }

      if (!slug) {
        res.status(400).json({ error: 'Provide slug for a single-section caption' });
        return;
      }
      const caption = generateCaption({ siteName, pageUrl, slug });
      res.status(200).json({ caption });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
