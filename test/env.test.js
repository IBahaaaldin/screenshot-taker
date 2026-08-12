import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadEnvFile } from '../src/env.js';

test('loadEnvFile sets process.env from a KEY=VALUE file, skipping comments/blanks', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-test-'));
  const envPath = path.join(dir, '.env');
  await fs.writeFile(
    envPath,
    [
      '# a comment',
      '',
      'FOO=bar',
      'QUOTED="hello world"',
      'SINGLE_QUOTED=\'single\'',
    ].join('\n'),
    'utf8'
  );

  delete process.env.FOO;
  delete process.env.QUOTED;
  delete process.env.SINGLE_QUOTED;

  loadEnvFile(envPath);

  assert.equal(process.env.FOO, 'bar');
  assert.equal(process.env.QUOTED, 'hello world');
  assert.equal(process.env.SINGLE_QUOTED, 'single');

  delete process.env.FOO;
  delete process.env.QUOTED;
  delete process.env.SINGLE_QUOTED;
  await fs.rm(dir, { recursive: true, force: true });
});

test('loadEnvFile does not overwrite an already-set environment variable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'env-test-'));
  const envPath = path.join(dir, '.env');
  await fs.writeFile(envPath, 'FOO=from-file\n', 'utf8');

  process.env.FOO = 'from-real-env';
  loadEnvFile(envPath);
  assert.equal(process.env.FOO, 'from-real-env');

  delete process.env.FOO;
  await fs.rm(dir, { recursive: true, force: true });
});

test('loadEnvFile does nothing when the file does not exist', () => {
  assert.doesNotThrow(() => loadEnvFile('/tmp/definitely-does-not-exist-env-file'));
});
