import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRunRouter } from '../src/routes/run.js';
import { readQueue } from '../src/postQueue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

async function startTestApp(outputRoot) {
  const app = express();
  app.use(express.json());
  const runs = new Map();
  app.use('/api', createRunRouter({ outputRoot, runs }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function waitForRunDone(base, runId) {
  const res = await fetch(`${base}/api/progress/${runId}`);
  const text = await res.text();
  const match = text.match(/data: (\{"type":"manifest-ready".*\})\n\n/);
  return JSON.parse(match[1]).manifest;
}

test('autoPost:true queues every composite with spaced scheduledFor when Instagram is configured', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autopost-test-'));
  const { server, base } = await startTestApp(outputRoot);
  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;
  const originalInterval = process.env.SCHEDULE_INTERVAL_HOURS;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId === undefined) delete process.env.IG_BUSINESS_ACCOUNT_ID; else process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    if (originalToken === undefined) delete process.env.IG_ACCESS_TOKEN; else process.env.IG_ACCESS_TOKEN = originalToken;
    if (originalInterval === undefined) delete process.env.SCHEDULE_INTERVAL_HOURS; else process.env.SCHEDULE_INTERVAL_HOURS = originalInterval;
  });

  process.env.IG_BUSINESS_ACCOUNT_ID = 'IGUSER';
  process.env.IG_ACCESS_TOKEN = 'TOKEN';
  process.env.SCHEDULE_INTERVAL_HOURS = '1';

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'autopost-fixture', autoPost: true }),
  });
  const { runId } = await runRes.json();
  const manifest = await waitForRunDone(base, runId);

  const totalComposites = manifest.pages.flatMap((p) => p.sections).filter((s) => s.composite).length;
  assert.ok(totalComposites > 0);

  const queue = await readQueue(path.join(outputRoot, 'post-queue.json'));
  assert.equal(queue.items.length, totalComposites);
  assert.ok(queue.items.every((item) => item.status === 'queued'));
  assert.ok(queue.items.every((item) => item.caption && item.caption.length > 0));

  const sortedTimes = queue.items.map((item) => Date.parse(item.scheduledFor)).sort((a, b) => a - b);
  for (let i = 1; i < sortedTimes.length; i++) {
    const gapHours = (sortedTimes[i] - sortedTimes[i - 1]) / (60 * 60 * 1000);
    assert.ok(gapHours >= 1, `expected at least 1h between scheduled items, got ${gapHours}h`);
  }
});

test('autoPost:true with Instagram not configured still succeeds and queues nothing', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autopost-test-noconfig-'));
  const { server, base } = await startTestApp(outputRoot);
  const originalUserId = process.env.IG_BUSINESS_ACCOUNT_ID;
  const originalToken = process.env.IG_ACCESS_TOKEN;
  delete process.env.IG_BUSINESS_ACCOUNT_ID;
  delete process.env.IG_ACCESS_TOKEN;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
    if (originalUserId !== undefined) process.env.IG_BUSINESS_ACCOUNT_ID = originalUserId;
    if (originalToken !== undefined) process.env.IG_ACCESS_TOKEN = originalToken;
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'autopost-noconfig', autoPost: true }),
  });
  const { runId } = await runRes.json();
  const manifest = await waitForRunDone(base, runId);
  assert.ok(manifest.pages.length > 0, 'run should still succeed');

  const queue = await readQueue(path.join(outputRoot, 'post-queue.json'));
  assert.equal(queue.items.length, 0);
});

test('autoPost defaults to false — a normal run queues nothing', async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autopost-test-default-'));
  const { server, base } = await startTestApp(outputRoot);
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputRoot, { recursive: true, force: true });
  });

  const runRes = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localFolder: fixtureDir, mode: 'auto', siteName: 'autopost-default' }),
  });
  const { runId } = await runRes.json();
  await waitForRunDone(base, runId);

  const queue = await readQueue(path.join(outputRoot, 'post-queue.json'));
  assert.equal(queue.items.length, 0);
});
