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
  for (const key of Object.keys(iframes)) {
    iframes[key].src = proxiedPageUrl(targetUrl);
  }
  stage.hidden = false;
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

const params = new URLSearchParams(window.location.search);
const prefill = params.get('url');
if (prefill) {
  const normalizedPrefill = normalizeUrl(prefill);
  if (normalizedPrefill) {
    urlInput.value = normalizedPrefill;
    loadAll(normalizedPrefill);
  }
}
