# Split-Crop Feature — Design

## Purpose

User's manual pre-tool workflow: take a screenshot, cut it into top/bottom
halves, post both as an Instagram carousel slide pair. Automate this against
the tool's existing composite mockup image (the overlapping desktop/laptop/
tablet/mobile "hero" image `buildComposite` already produces), not the raw
page screenshot.

## Scope

One subsystem: crop an existing composite PNG into two stacked halves and
wire the result into the manifest and gallery. No new capture, no new
device-mockup style, no configurable UI (cut point is fixed at 50%,
matching current manual practice — can be revisited later if needed).

## Architecture

New module `src/splitCrop.js`, pure image-processing (no browser needed):

```js
export async function splitTopBottom(compositeImagePath, outputDir, cutPercent = 50)
// returns { top: <path>, bottom: <path> }
```

Uses the `sharp` npm package (new dependency) for the crop — native, fast,
already the standard choice for Node image manipulation; no need to spin up
a Playwright page just to crop a PNG.

- Reads image dimensions via `sharp(path).metadata()`.
- `cutPercent` clamped 10-90 (matches Image Splitter's existing guard,
  ported for consistency even though the UI won't expose it yet).
- `cutY = round(height * cutPercent / 100)`.
- Extracts `(0,0,width,cutY)` → `<slug>-composite.top.png` and
  `(0,cutY,width,height-cutY)` → `<slug>-composite.bottom.png`, written to
  the same `composites/` directory the source composite lives in.

## Pipeline Integration

`src/pipeline.js`'s `buildCompositesForPage`: immediately after a
`compositePath` is produced for a section, call `splitTopBottom` on it and
attach the result to that section's manifest entry:

```js
sections.push({ slug, viewports: imagesByViewport, composite: compositePath, splitCrop });
```

`splitCrop` is `null` when there was no composite (mirrors the existing
`composite: null` fallback for sections that failed to capture at every
viewport).

## Manifest Shape

```json
{
  "slug": "hero",
  "viewports": { "...": "..." },
  "composite": ".../hero-composite.png",
  "splitCrop": {
    "top": ".../hero-composite.top.png",
    "bottom": ".../hero-composite.bottom.png"
  }
}
```

`splitCrop: null` when `composite` is null.

## Frontend / Gallery

In `public/app.js`'s per-section render: below the existing composite
image, render the two split halves side by side (or stacked, matching the
composite's own display width) with their own download links. Reuses
existing image-card styling — no new CSS component needed beyond a small
layout tweak for the pair.

The existing "Post as carousel" / per-composite post buttons are NOT
extended to the split images in this pass — posting flow stays scoped to
`composite` images only, to keep this change to the crop step itself. (Can
be a fast follow if wanted later.)

## Testing

- `test/splitCrop.test.js`: unit tests against a fixture PNG — verify
  output dimensions (top height ≈ 50% of source, bottom = remainder),
  verify both files exist and are valid PNGs, verify clamping behavior at
  extreme `cutPercent` values (0, 100, negative, >100).
- `test/pipeline.test.js` (existing file): extend to assert a run's
  manifest sections carry a populated `splitCrop` field when a composite
  was built, and `null` when it wasn't.

## Out of Scope (explicitly not building)

- Configurable cut percent in the UI.
- Left/right split direction.
- Splitting the raw per-viewport screenshots instead of the composite.
- Wiring split images into the Instagram posting/carousel flow.
