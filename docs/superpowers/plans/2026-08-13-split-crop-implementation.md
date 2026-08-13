# Split-Crop Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crop each section's composite mockup image into top/bottom halves for Instagram carousel posting, matching the user's manual pre-tool workflow.

**Architecture:** New `src/splitCrop.js` module crops an existing composite PNG using `sharp`. `src/pipeline.js` calls it right after building each section's composite and attaches the result to the manifest. `public/app.js` renders the two halves in the gallery below each composite.

**Tech Stack:** Node.js, `sharp` (new dependency) for image cropping, `node:test` for tests.

## Global Constraints

- Cut point fixed at 50%, clamped 10-90 (no configurable UI in this pass).
- Split source is the composite mockup image (`section.composite`), never the raw per-viewport screenshots.
- `splitCrop` manifest field is `null` when `composite` is `null` (mirrors existing fallback pattern).
- Output files live in the same `composites/` directory as the source composite: `<slug>-composite.top.png` and `<slug>-composite.bottom.png`.
- Do not wire split images into the Instagram posting/carousel flow in this pass — posting stays scoped to `composite` images only.
- Full spec: `docs/superpowers/specs/2026-08-13-split-crop-design.md`.

---

### Task 1: `splitCrop` module

**Files:**
- Create: `src/splitCrop.js`
- Modify: `package.json` (add `sharp` dependency)
- Test: `test/splitCrop.test.js`

**Interfaces:**
- Produces: `export async function splitTopBottom(compositeImagePath, outputDir, cutPercent = 50)` → resolves to `{ top: <absolute path string>, bottom: <absolute path string> }`. Output filenames are derived from the source filename's stem: for input `.../composites/hero-composite.png`, outputs are `<outputDir>/hero-composite.top.png` and `<outputDir>/hero-composite.bottom.png`.

- [ ] **Step 1: Install `sharp`**

Run: `npm install sharp`

- [ ] **Step 2: Write the failing tests**

Create `test/fixtures/` does NOT need a new fixture — generate a test image in-memory in the test itself using `sharp` (already a dependency after Step 1), so the test has no binary fixture file to maintain.

```js
// test/splitCrop.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { splitTopBottom } from '../src/splitCrop.js';

async function makeTestImage(dir, width, height) {
  const imgPath = path.join(dir, 'source-composite.png');
  await sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toFile(imgPath);
  return imgPath;
}

test('splitTopBottom crops a composite into top and bottom halves at the default 50%', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-crop-test-'));
  try {
    const source = await makeTestImage(dir, 400, 300);
    const result = await splitTopBottom(source, dir);

    assert.equal(result.top, path.join(dir, 'source-composite.top.png'));
    assert.equal(result.bottom, path.join(dir, 'source-composite.bottom.png'));

    const topMeta = await sharp(result.top).metadata();
    const bottomMeta = await sharp(result.bottom).metadata();

    assert.equal(topMeta.width, 400);
    assert.equal(topMeta.height, 150);
    assert.equal(bottomMeta.width, 400);
    assert.equal(bottomMeta.height, 150);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('splitTopBottom respects a custom cutPercent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-crop-test-'));
  try {
    const source = await makeTestImage(dir, 200, 400);
    const result = await splitTopBottom(source, dir, 25);

    const topMeta = await sharp(result.top).metadata();
    const bottomMeta = await sharp(result.bottom).metadata();

    assert.equal(topMeta.height, 100);
    assert.equal(bottomMeta.height, 300);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('splitTopBottom clamps cutPercent to the 10-90 range', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-crop-test-'));
  try {
    const source = await makeTestImage(dir, 100, 1000);

    const tooLow = await splitTopBottom(source, dir, 0);
    const tooLowMeta = await sharp(tooLow.top).metadata();
    assert.equal(tooLowMeta.height, 100); // clamped to 10%

    const tooHigh = await splitTopBottom(source, dir, 150);
    const tooHighMeta = await sharp(tooHigh.top).metadata();
    assert.equal(tooHighMeta.height, 900); // clamped to 90%
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/splitCrop.test.js`
Expected: FAIL with "Cannot find module '../src/splitCrop.js'" or similar.

- [ ] **Step 4: Write the implementation**

```js
// src/splitCrop.js
import path from 'node:path';
import sharp from 'sharp';

export async function splitTopBottom(compositeImagePath, outputDir, cutPercent = 50) {
  const clamped = Math.max(10, Math.min(90, cutPercent));
  const { width, height } = await sharp(compositeImagePath).metadata();
  const cutY = Math.max(1, Math.min(height - 1, Math.round((height * clamped) / 100)));

  const stem = path.basename(compositeImagePath, path.extname(compositeImagePath));
  const topPath = path.join(outputDir, `${stem}.top.png`);
  const bottomPath = path.join(outputDir, `${stem}.bottom.png`);

  await sharp(compositeImagePath)
    .extract({ left: 0, top: 0, width, height: cutY })
    .toFile(topPath);

  await sharp(compositeImagePath)
    .extract({ left: 0, top: cutY, width, height: height - cutY })
    .toFile(bottomPath);

  return { top: topPath, bottom: bottomPath };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/splitCrop.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/splitCrop.js test/splitCrop.test.js
git commit -m "feat: add splitTopBottom composite cropper"
```

---

### Task 2: Pipeline integration + manifest field

**Files:**
- Modify: `src/pipeline.js:66-83` (the `buildCompositesForPage` function)
- Test: `test/pipeline.test.js` (extend the existing "runPipeline crawls, shoots, composites, and writes a manifest" test, and the manifest-shape assertions)

**Interfaces:**
- Consumes: `splitTopBottom(compositeImagePath, outputDir, cutPercent = 50)` from Task 1, returning `{ top, bottom }`.
- Produces: each entry in `manifest.pages[].sections[]` gains a `splitCrop` field: `{ top: <path>, bottom: <path> }` when `composite` is non-null, `null` when `composite` is `null`.

- [ ] **Step 1: Write the failing test**

Add this assertion inside the existing test `'runPipeline crawls, shoots, composites, and writes a manifest for the fixture site'` in `test/pipeline.test.js`, right after the existing `for (const section of home.sections) { ... }` loop that checks `section.composite`:

```js
    for (const section of home.sections) {
      assert.ok(section.splitCrop, 'every section with a composite should have a splitCrop');
      const topStat = await fs.stat(section.splitCrop.top);
      const bottomStat = await fs.stat(section.splitCrop.bottom);
      assert.ok(topStat.size > 0);
      assert.ok(bottomStat.size > 0);
    }
```

Also add a new dedicated test in the same file for the null case, using the existing `failureFixtureDir` fixture (already used elsewhere in this file for sections that fail every viewport):

```js
test('runPipeline sets splitCrop to null for sections with no composite', async () => {
  const server = await startLocalServer(failureFixtureDir);
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-splitcrop-null-test-'));
  try {
    const manifest = await runPipeline(
      {
        startUrl: `${server.url}/index.html`,
        mode: 'auto',
        selectors: [],
        siteName: 'fixture-site-failure',
        outputRoot,
        maxPages: 10,
      },
      () => {}
    );

    const page = manifest.pages[0];
    const missingComposite = page.sections.find((s) => s.composite === null);
    assert.ok(missingComposite, 'fixture should include a section with no composite');
    assert.equal(missingComposite.splitCrop, null);
  } finally {
    await server.close();
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});
```

Read `test/pipeline.test.js` in full first to confirm `failureFixtureDir`'s existing tests and how they assert `composite === null`, so the new test matches established conventions in that file (e.g. which section slug ends up with no composite).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/pipeline.test.js`
Expected: FAIL — `section.splitCrop` is `undefined`, `assert.ok(undefined)` fails.

- [ ] **Step 3: Implement**

In `src/pipeline.js`, add the import:

```js
import { splitTopBottom } from './splitCrop.js';
```

Modify `buildCompositesForPage`'s loop body (currently ends with `sections.push({ slug, viewports: imagesByViewport, composite: compositePath });`):

```js
async function buildCompositesForPage(browser, pageOutputDir, viewportResults, onProgress) {
  const slugs = new Set();
  for (const { sections } of viewportResults) {
    for (const { slug } of sections) slugs.add(slug);
  }

  const sections = [];
  for (const slug of slugs) {
    const imagesByViewport = {};
    for (const { viewport, sections: vSections } of viewportResults) {
      const match = vSections.find((s) => s.slug === slug);
      if (match) imagesByViewport[viewport] = match.path;
    }

    let compositePath = null;
    let splitCrop = null;
    if (Object.keys(imagesByViewport).length > 0) {
      const compositesDir = path.join(pageOutputDir, 'composites');
      const outputPath = path.join(compositesDir, `${slug}-composite.png`);
      compositePath = await buildComposite(browser, imagesByViewport, outputPath);
      onProgress({ type: 'composite-done', message: `Composite ready: ${slug}` });

      splitCrop = await splitTopBottom(compositePath, compositesDir);
      onProgress({ type: 'split-crop-done', message: `Split crop ready: ${slug}` });
    }

    sections.push({ slug, viewports: imagesByViewport, composite: compositePath, splitCrop });
  }

  return sections;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/pipeline.test.js`
Expected: PASS (all tests in file, including the 2 new/modified assertions)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (no regressions elsewhere — nothing else reads `manifest.pages[].sections[]` shape strictly except the frontend, which Task 3 updates)

- [ ] **Step 6: Commit**

```bash
git add src/pipeline.js test/pipeline.test.js
git commit -m "feat: wire split-crop into pipeline and manifest"
```

---

### Task 3: Gallery UI — render split-crop halves

**Files:**
- Modify: `public/app.js:339-387` (the per-section loop inside `renderGallery`)
- Modify: `public/style.css` (small layout addition for the split-image pair)

**Interfaces:**
- Consumes: `section.splitCrop` (`{ top, bottom }` or `null`) from the manifest, per Task 2. `toWebPath(absolutePath)` helper already defined in `public/app.js:394-397` — reuse it, do not duplicate its logic.

- [ ] **Step 1: Read current gallery rendering code**

Read `public/app.js` lines 300-397 in full (the whole `renderGallery` function) to confirm exact insertion point and existing DOM-building conventions (no template literals used for DOM — everything is `document.createElement` + property assignment, per the existing `frame`/`tag`/`postBtn` pattern above).

- [ ] **Step 2: Implement — add split-crop row inside the per-section loop**

In `public/app.js`, inside the `for (const section of page.sections)` loop in `renderGallery`, immediately after the existing `if (section.composite) { ... }` block that appends the `postBtn` (i.e. right before `strip.appendChild(frame);`), add:

```js
      if (section.splitCrop) {
        const splitRow = document.createElement('div');
        splitRow.className = 'split-crop-row';

        for (const [label, imgPath] of [
          ['top', section.splitCrop.top],
          ['bottom', section.splitCrop.bottom],
        ]) {
          const splitCard = document.createElement('div');
          splitCard.className = 'split-crop-card';

          const splitImg = document.createElement('img');
          splitImg.src = toWebPath(imgPath);
          splitImg.alt = `${section.slug} composite — ${label} half`;
          splitImg.loading = 'lazy';
          splitCard.appendChild(splitImg);

          const splitLabel = document.createElement('span');
          splitLabel.className = 'split-crop-label';
          splitLabel.textContent = label;
          splitCard.appendChild(splitLabel);

          const downloadLink = document.createElement('a');
          downloadLink.href = toWebPath(imgPath);
          downloadLink.download = '';
          downloadLink.className = 'split-crop-download';
          downloadLink.textContent = 'Download';
          splitCard.appendChild(downloadLink);

          splitRow.appendChild(splitCard);
        }

        frame.appendChild(splitRow);
      }
```

- [ ] **Step 3: Add CSS**

Read `public/style.css` first to match existing naming conventions (e.g. how `.frame`, `.frame-tag`, `.frame-post-btn` are styled — spacing units, color variables) before adding. Append a new rule block:

```css
.split-crop-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.split-crop-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.split-crop-card img {
  width: 100%;
  display: block;
}

.split-crop-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  opacity: 0.7;
}
```

Match this block's color/font/spacing values to whatever variables the rest of `style.css` already uses (e.g. if the file defines `--muted-color` or similar for secondary text, use it instead of a bare `opacity: 0.7`) rather than introducing new ad-hoc values.

- [ ] **Step 4: Manual verification**

Run: `npm start`, open `http://localhost:3000`, run a capture against any test site (or a real one), confirm each section's gallery card shows the composite followed by two smaller top/bottom split images with working download links, and that clicking download saves the correct half.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — this task has no new automated frontend tests (no existing frontend test harness in this project to extend; verification is manual per Step 4, consistent with how the rest of `public/app.js` is untested).

- [ ] **Step 6: Commit**

```bash
git add public/app.js public/style.css
git commit -m "feat: render split-crop halves in gallery"
```

---

### Final Task: Whole-branch review

After Task 3, dispatch a final code reviewer over the full diff against the base branch before merging, per the subagent-driven-development skill. Check in particular:
- `sharp` is a real, correctly-declared dependency (not just devDependency) since it's used in production pipeline code.
- No dead code left from the split between composite-only and split-crop-inclusive sections.
- Manifest backward-compatibility: any code reading old manifests (pre-existing runs on disk without `splitCrop`) doesn't crash — check `public/app.js`'s `section.splitCrop` access is guarded with the `if (section.splitCrop)` check (it is, per Task 3 Step 2), and confirm no other file reads `section.splitCrop` unguarded.
