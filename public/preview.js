// safeAreaTop is the fraction of the device's WIDTH that its status area
// occupies — an iPhone 16 Pro reserves 59pt of its 402pt width (0.147). These
// captures come from a browser with no safe area, so without it the site's own
// header renders at y=0 and slides under the Dynamic Island, which reads as a
// black blob pasted over the content. src/composite.js insets the exported
// screenshots the same way.
const DEVICES = {
  desktop: { width: 1920 },
  laptop: { width: 1440 },
  tablet: { width: 768 },
  mobile: { width: 390, safeAreaTop: 0.147 },
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
  // Uses CSS zoom, not transform: scale — a scaled-via-transform cross-origin
  // sandboxed iframe silently stops receiving wheel/scroll input in Chromium
  // (the visual transform doesn't correctly hit-test into the iframe's own
  // document), which made every device preview look frozen. zoom scales the
  // rendered layout AND keeps input routing correct.
  for (const [key, config] of Object.entries(DEVICES)) {
    const frame = document.querySelector(`.preview-frame-${key}`);
    const iframe = iframes[key];
    if (!frame || !iframe) continue;
    const scale = frame.clientWidth / config.width;
    // Called on load, the stage may not be laid out yet (clientWidth 0),
    // which yields scale 0 — that would set zoom:0 and blank every device
    // until something else triggered a resize. Skip and wait for the
    // ResizeObserver below to fire with a real size.
    if (!Number.isFinite(scale) || scale <= 0) continue;
    iframe.style.zoom = scale;
    // Height stays the device's true viewport height so the site lays out
    // exactly as it would on the real device; the inset shifts the page down
    // and the overflow past the bottom is clipped by the frame, which is what
    // a real phone shows below its status area.
    iframe.style.height = `${frame.clientHeight / scale}px`;
    // In the iframe's own device pixels — zoom then scales it to the right
    // proportion on screen. An em here would be multiplied by zoom twice over.
    const inset = (config.safeAreaTop || 0) * config.width;
    iframe.style.marginTop = inset ? `${inset}px` : '';
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

  // Scroll is deliberately NOT relayed between devices — each frame scrolls
  // independently (see src/previewProxy.js). Navigation still is, so all
  // four devices follow a link click to the same page.
  if (event.data.type === 'preview-nav' && typeof event.data.url === 'string') {
    // Never point the preview at the app's own origin — proxying ourselves
    // renders Screenshot Taker inside its own device frames. The bridge guards
    // this too; this is the backstop on the receiving end.
    let target;
    try {
      target = new URL(event.data.url, window.location.href);
    } catch {
      return;
    }
    if (target.origin === window.location.origin) return;

    urlInput.value = target.href;
    for (const key of Object.keys(iframes)) {
      iframes[key].src = proxiedPageUrl(target.href);
    }
  }
});

// The stage's width is driven by CSS (viewport height, container width), so
// observe the stage itself rather than only listening for window resizes —
// that also covers the very first layout, which a resize event doesn't fire
// for.
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(scaleFramesToFit).observe(stage);
}
window.addEventListener('resize', scaleFramesToFit);
// Chromium pauses ResizeObserver and rAF delivery for hidden pages, so a
// window resized while the app was occluded or minimised would come back
// with stale scales. Re-fit when the page becomes visible again.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scaleFramesToFit();
});

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

// No ?url= means a normal (non-recording) page load — show something live
// immediately instead of an empty stage, matching the "devices are the
// first thing you see" goal. Recording mode always supplies its own ?url=
// explicitly (see src/screenRecorder.js), so this default never fires there.
const DEFAULT_PREVIEW_URL = 'https://ibahaaaldin.github.io';

const prefill = params.get('url') || DEFAULT_PREVIEW_URL;
const normalizedPrefill = normalizeUrl(prefill);
if (normalizedPrefill) {
  urlInput.value = normalizedPrefill;
  loadAll(normalizedPrefill);
}
