import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPH_API_BASE,
  createImageContainer,
  pollContainerStatus,
  publishContainer,
  postSingleImage,
} from '../src/instagram.js';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('createImageContainer posts to /{igUserId}/media and returns the container id', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ id: 'container-123' });
  };

  const id = await createImageContainer(
    { igUserId: 'IGUSER', accessToken: 'TOKEN', imageUrl: 'https://ex.com/a.png', caption: 'hi' },
    fakeFetch
  );

  assert.equal(id, 'container-123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${GRAPH_API_BASE}/IGUSER/media`);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('image_url'), 'https://ex.com/a.png');
  assert.equal(body.get('caption'), 'hi');
  assert.equal(body.get('access_token'), 'TOKEN');
});

test('createImageContainer omits caption for carousel items', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push(options);
    return jsonResponse({ id: 'child-1' });
  };

  await createImageContainer(
    { igUserId: 'IGUSER', accessToken: 'TOKEN', imageUrl: 'https://ex.com/a.png', isCarouselItem: true },
    fakeFetch
  );

  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('is_carousel_item'), 'true');
  assert.equal(body.has('caption'), false);
});

test('pollContainerStatus resolves once status_code is FINISHED', async () => {
  let call = 0;
  const statuses = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];
  const fakeFetch = async () => {
    const status_code = statuses[call++];
    return jsonResponse({ status_code });
  };

  await assert.doesNotReject(() =>
    pollContainerStatus({ creationId: 'c1', accessToken: 'TOKEN', delayMs: 1, maxAttempts: 10 }, fakeFetch)
  );
  assert.equal(call, 3);
});

test('pollContainerStatus throws on ERROR status', async () => {
  const fakeFetch = async () => jsonResponse({ status_code: 'ERROR' });
  await assert.rejects(
    () => pollContainerStatus({ creationId: 'c1', accessToken: 'TOKEN', delayMs: 1, maxAttempts: 10 }, fakeFetch),
    /ERROR/
  );
});

test('pollContainerStatus throws after exceeding maxAttempts while still IN_PROGRESS', async () => {
  const fakeFetch = async () => jsonResponse({ status_code: 'IN_PROGRESS' });
  await assert.rejects(() =>
    pollContainerStatus({ creationId: 'c1', accessToken: 'TOKEN', delayMs: 1, maxAttempts: 3 }, fakeFetch)
  );
});

test('publishContainer posts to /{igUserId}/media_publish and returns the media id', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ id: 'media-999' });
  };

  const id = await publishContainer({ igUserId: 'IGUSER', accessToken: 'TOKEN', creationId: 'c1' }, fakeFetch);

  assert.equal(id, 'media-999');
  assert.equal(calls[0].url, `${GRAPH_API_BASE}/IGUSER/media_publish`);
  const body = new URLSearchParams(calls[0].options.body);
  assert.equal(body.get('creation_id'), 'c1');
});

test('a non-ok response throws with the Graph API error message', async () => {
  const fakeFetch = async () => jsonResponse({ error: { message: 'Invalid token' } }, false, 400);
  await assert.rejects(
    () => createImageContainer({ igUserId: 'X', accessToken: 'BAD', imageUrl: 'https://ex.com/a.png' }, fakeFetch),
    /Invalid token/
  );
});

test('postSingleImage composes create + poll + publish into one media id', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/media')) return jsonResponse({ id: 'container-1' });
    if (url.endsWith('/media_publish')) return jsonResponse({ id: 'media-1' });
    return jsonResponse({ status_code: 'FINISHED' }); // the polling GET
  };

  const mediaId = await postSingleImage(
    { igUserId: 'IGUSER', accessToken: 'TOKEN', imageUrl: 'https://ex.com/a.png', caption: 'hi' },
    fakeFetch
  );

  assert.equal(mediaId, 'media-1');
  assert.ok(calls.some((u) => u.endsWith('/media')));
  assert.ok(calls.some((u) => u.includes('container-1')));
  assert.ok(calls.some((u) => u.endsWith('/media_publish')));
});
