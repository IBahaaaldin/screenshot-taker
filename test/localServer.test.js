// test/localServer.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from '../src/localServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures', 'site');

test('startLocalServer serves the folder and returns a working url', async () => {
  const server = await startLocalServer(fixtureDir);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const res = await fetch(`${server.url}/index.html`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Fixture Home/);

  await server.close();
});

test('startLocalServer rejects a nonexistent folder path', async () => {
  const missing = path.join(__dirname, 'fixtures', 'does-not-exist-folder');
  await assert.rejects(() => startLocalServer(missing), /Local folder not found/);
});

test('startLocalServer picks a different free port on concurrent calls', async () => {
  const a = await startLocalServer(fixtureDir);
  const b = await startLocalServer(fixtureDir);
  assert.notEqual(a.url, b.url);
  await a.close();
  await b.close();
});

test('startLocalServer rejects path traversal into a sibling directory sharing a name prefix', async () => {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'localserver-traversal-'));
  const siteDir = path.join(tmpBase, 'site');
  const evilDir = path.join(tmpBase, 'site-evil');
  await fs.mkdir(siteDir, { recursive: true });
  await fs.mkdir(evilDir, { recursive: true });
  await fs.writeFile(path.join(siteDir, 'index.html'), '<html>Fixture Home</html>');
  await fs.writeFile(path.join(evilDir, 'secret.txt'), 'TOP SECRET');

  const server = await startLocalServer(siteDir);
  try {
    // Use %2e%2e so the URL parser doesn't normalize away the traversal
    // before the request reaches the server (it must be decoded server-side).
    const res = await fetch(`${server.url}/%2e%2e/site-evil/secret.txt`);
    assert.notEqual(res.status, 200);
    const body = await res.text();
    assert.doesNotMatch(body, /TOP SECRET/);
  } finally {
    await server.close();
    await fs.rm(tmpBase, { recursive: true, force: true });
  }
});
