export const GRAPH_API_BASE = 'https://graph.facebook.com/v19.0';

export async function createImageContainer(
  { igUserId, accessToken, imageUrl, caption, isCarouselItem = false },
  fetchImpl = fetch
) {
  const params = { image_url: imageUrl, access_token: accessToken };
  if (isCarouselItem) {
    params.is_carousel_item = 'true';
  } else if (caption) {
    params.caption = caption;
  }
  const body = await graphPost(`/${igUserId}/media`, params, fetchImpl);
  return body.id;
}

export async function pollContainerStatus(
  { creationId, accessToken, delayMs = 2000, maxAttempts = 30 },
  fetchImpl = fetch
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const body = await graphGet(`/${creationId}`, { fields: 'status_code', access_token: accessToken }, fetchImpl);
    if (body.status_code === 'FINISHED') return;
    if (body.status_code === 'ERROR' || body.status_code === 'EXPIRED') {
      throw new Error(`Instagram media container ${creationId} failed with status ${body.status_code}`);
    }
    await sleep(delayMs);
  }
  throw new Error(`Instagram media container ${creationId} did not finish processing in time`);
}

export async function publishContainer({ igUserId, accessToken, creationId }, fetchImpl = fetch) {
  const body = await graphPost(
    `/${igUserId}/media_publish`,
    { creation_id: creationId, access_token: accessToken },
    fetchImpl
  );
  return body.id;
}

export async function postSingleImage({ igUserId, accessToken, imageUrl, caption }, fetchImpl = fetch) {
  const creationId = await createImageContainer({ igUserId, accessToken, imageUrl, caption }, fetchImpl);
  await pollContainerStatus({ creationId, accessToken }, fetchImpl);
  return publishContainer({ igUserId, accessToken, creationId }, fetchImpl);
}

async function graphPost(path, params, fetchImpl) {
  const res = await fetchImpl(`${GRAPH_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return parseGraphResponse(res);
}

async function graphGet(path, params, fetchImpl) {
  const query = new URLSearchParams(params).toString();
  const res = await fetchImpl(`${GRAPH_API_BASE}${path}?${query}`);
  return parseGraphResponse(res);
}

async function parseGraphResponse(res) {
  const body = await res.json();
  if (!res.ok || body.error) {
    throw new Error(body.error?.message || `Instagram API request failed (${res.status})`);
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
