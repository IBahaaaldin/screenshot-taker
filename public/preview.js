const DEVICES = {
  desktop: { width: 1920 },
  laptop: { width: 1440 },
  tablet: { width: 768 },
  mobile: { width: 390 },
};

const form = document.getElementById('preview-form');
const urlInput = document.getElementById('preview-url');
const stage = document.getElementById('preview-stage');
const iframes = {
  desktop: document.getElementById('preview-iframe-desktop'),
  laptop: document.getElementById('preview-iframe-laptop'),
  tablet: document.getElementById('preview-iframe-tablet'),
  mobile: document.getElementById('preview-iframe-mobile'),
};

let syncing = false;

function proxiedPageUrl(targetUrl) {
  return `/api/preview/page?url=${encodeURIComponent(targetUrl)}`;
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
  if (!fromDevice || syncing) return;

  if (event.data.type === 'preview-scroll') {
    syncing = true;
    for (const key of Object.keys(iframes)) {
      if (key === fromDevice) continue;
      iframes[key].contentWindow?.postMessage({ type: 'preview-scroll-to', y: event.data.y }, '*');
    }
    syncing = false;
  }

  if (event.data.type === 'preview-nav' && typeof event.data.url === 'string') {
    syncing = true;
    for (const key of Object.keys(iframes)) {
      iframes[key].src = proxiedPageUrl(event.data.url);
    }
    syncing = false;
  }
});

window.addEventListener('resize', scaleFramesToFit);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = urlInput.value.trim();
  if (!value) return;
  loadAll(value);
});

const params = new URLSearchParams(window.location.search);
const prefill = params.get('url');
if (prefill) {
  urlInput.value = prefill;
  loadAll(prefill);
}
