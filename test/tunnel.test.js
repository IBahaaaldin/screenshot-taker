// test/tunnel.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTunnel } from '../src/tunnel.js';

test('startTunnel wraps the underlying tunnel implementation with { url, close }', async () => {
  let closed = false;
  let requestedPort = null;
  const fakeLocaltunnel = async ({ port }) => {
    requestedPort = port;
    return {
      url: 'https://fake-subdomain.loca.lt',
      close: async () => {
        closed = true;
      },
    };
  };

  const tunnel = await startTunnel(4321, fakeLocaltunnel);

  assert.equal(requestedPort, 4321);
  assert.equal(tunnel.url, 'https://fake-subdomain.loca.lt');

  await tunnel.close();
  assert.equal(closed, true);
});
