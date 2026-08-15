const DEVICES = {
  desktop: { width: 1920 },
  laptop: { width: 1440 },
  tablet: { width: 768 },
  mobile: { width: 390 },
};

const form = document.getElementById('preview-form');
const urlInput = document.getElementById('preview-url');
const urlError = document.getElementById('preview-url-error');
const stage = document.getElementById('preview-stage');
const iframes = {
  desktop: document.getElementById('preview-iframe-desktop'),
  laptop: document.getElementById('preview-iframe-laptop'),
  tablet: document.getElementById('preview-iframe-tablet'),
  mobile: document.getElementById('preview-iframe-mobile'),
};

const recordBtn = document.getElementById('record-video-btn');
const recordResult = document.getElementById('record-result');
const recordVideo = document.getElementById('record-video');
const recordDownload = document.getElementById('record-download');
const recordError = document.getElementById('record-error');

let currentPreviewUrl = null;

function proxiedPageUrl(targetUrl) {
  return `/api/preview/page?url=${encodeURIComponent(targetUrl)}`;
}

function normalizeUrl(value) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withProtocol).href;
  } catch {
    return null;
  }
}

function showUrlError(message) {
  if (!urlError) return;
  urlError.textContent = message;
  urlError.hidden = false;
}

function clearUrlError() {
  if (!urlError) return;
  urlError.hidden = true;
  urlError.textContent = '';
}

function scaleFramesToFit() {
  for (const [key, config] of Object.entries(DEVICES)) {
    const frame = document.querySelector(`.preview-frame-${key}`);
    const iframe = iframes[key];
    if (!frame || !iframe) continue;
    const scale = frame.clientWidth / config.width;
    iframe.style.transform = `scale(${scale})`;
    iframe.style.height = `${frame.clientHeight / scale}px`;
  }
}

function loadAll(targetUrl) {
  currentPreviewUrl = targetUrl;
  for (const key of Object.keys(iframes)) {
    iframes[key].src = proxiedPageUrl(targetUrl);
  }
  stage.hidden = false;
  recordBtn.disabled = false;
  scaleFramesToFit();
}

function sourceDeviceOf(win) {
  return Object.keys(iframes).find((key) => iframes[key].contentWindow === win);
}

window.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return;
  const fromDevice = sourceDeviceOf(event.source);
  if (!fromDevice) return;

  if (event.data.type === 'preview-scroll') {
    for (const key of Object.keys(iframes)) {
      if (key === fromDevice) continue;
      iframes[key].contentWindow?.postMessage({ type: 'preview-scroll-to', y: event.data.y }, '*');
    }
  }

  if (event.data.type === 'preview-nav' && typeof event.data.url === 'string') {
    for (const key of Object.keys(iframes)) {
      iframes[key].src = proxiedPageUrl(event.data.url);
    }
  }
});

window.addEventListener('resize', scaleFramesToFit);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = urlInput.value.trim();
  if (!value) return;
  const normalized = normalizeUrl(value);
  if (!normalized) {
    showUrlError('Enter a valid URL, e.g. example.com or https://example.com');
    return;
  }
  clearUrlError();
  loadAll(normalized);
});

recordBtn.addEventListener('click', async () => {
  if (!currentPreviewUrl) return;
  recordError.hidden = true;
  recordResult.hidden = true;
  recordBtn.disabled = true;
  recordBtn.classList.add('is-loading');
  const labelEl = recordBtn.querySelector('.shutter-label');
  const originalLabel = labelEl.textContent;
  labelEl.textContent = 'Recording…';
  try {
    const res = await fetch('/api/preview/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentPreviewUrl }),
    });
    const body = await res.json();
    if (!res.ok) {
      throw new Error(body.error || 'Recording failed');
    }
    recordVideo.src = body.downloadUrl;
    recordDownload.href = body.downloadUrl;
    recordResult.hidden = false;
  } catch (err) {
    const firstLine = String(err.message).split('\n')[0].trim();
    recordError.textContent = firstLine || 'Recording failed';
    recordError.hidden = false;
  } finally {
    recordBtn.disabled = false;
    recordBtn.classList.remove('is-loading');
    labelEl.textContent = originalLabel;
  }
});

const params = new URLSearchParams(window.location.search);

if (params.get('record') === '1') {
  document.body.classList.add('recording-mode');
}

const prefill = params.get('url');
if (prefill) {
  const normalizedPrefill = normalizeUrl(prefill);
  if (normalizedPrefill) {
    urlInput.value = normalizedPrefill;
    loadAll(normalizedPrefill);
  }
}
