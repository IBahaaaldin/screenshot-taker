import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeManifest, readManifest } from '../src/manifest.js';

test('writeManifest then readManifest round-trips the data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-test-'));
  const manifest = {
    site: 'example.com',
    generatedAt: '2026-08-13T00:00:00.000Z',
    pages: [
      {
        url: 'https://example.com/',
        sections: [
          {
            slug: 'section-0',
            viewports: { desktop: '/out/desktop/section-0.png', mobile: '/out/mobile/section-0.png' },
            composite: '/out/composites/section-0-composite.png',
          },
        ],
      },
    ],
  };

  await writeManifest(dir, manifest);
  const filePath = path.join(dir, 'manifest.json');
  const stat = await fs.stat(filePath);
  assert.ok(stat.isFile());

  const readBack = await readManifest(dir);
  assert.deepEqual(readBack, manifest);

  await fs.rm(dir, { recursive: true, force: true });
});
