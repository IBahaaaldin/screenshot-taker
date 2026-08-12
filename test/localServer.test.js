// test/localServer.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
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

test('startLocalServer picks a different free port on concurrent calls', async () => {
  const a = await startLocalServer(fixtureDir);
  const b = await startLocalServer(fixtureDir);
  assert.notEqual(a.url, b.url);
  await a.close();
  await b.close();
});
