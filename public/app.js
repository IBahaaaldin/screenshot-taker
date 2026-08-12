// public/app.js
const form = document.getElementById('run-form');
const sourceType = document.getElementById('sourceType');
const sourceLabel = document.getElementById('sourceLabel');
const sourceValue = document.getElementById('sourceValue');
const modeSelect = document.getElementById('mode');
const selectorsRow = document.getElementById('selectorsRow');
const submitBtn = document.getElementById('submit-btn');
const progressSection = document.getElementById('progress');
const progressLog = document.getElementById('progress-log');
const statusLamp = document.getElementById('status-lamp');
const gallerySection = document.getElementById('gallery');
const galleryContent = document.getElementById('gallery-content');
const downloadLink = document.getElementById('download-link');

const SOURCE_PLACEHOLDERS = {
  url: { label: 'Source URL', placeholder: 'https://example.com' },
  localFolder: { label: 'Local folder path', placeholder: '/Users/you/projects/my-site' },
};

sourceType.addEventListener('change', () => {
  const cfg = SOURCE_PLACEHOLDERS[sourceType.value];
  sourceLabel.textContent = cfg.label;
  sourceValue.placeholder = cfg.placeholder;
});

modeSelect.addEventListener('change', () => {
  selectorsRow.hidden = modeSelect.value !== 'selectors';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  progressLog.innerHTML = '';
  galleryContent.innerHTML = '';
  progressSection.hidden = false;
  gallerySection.hidden = true;
  setStatusLamp('running');
  setSubmitting(true);
  progressSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const body = {
    siteName: document.getElementById('siteName').value,
    mode: modeSelect.value,
    selectors: document.getElementById('selectors').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
  if (sourceType.value === 'url') {
    body.url = sourceValue.value;
  } else {
    body.localFolder = sourceValue.value;
  }

  let runRes;
  try {
    runRes = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    logLine('error', `Could not reach the server — ${err.message}`);
    setStatusLamp('failed');
    setSubmitting(false);
    return;
  }

  if (!runRes.ok) {
    let message = `Request failed (status ${runRes.status})`;
    try {
      const errBody = await runRes.json();
      if (errBody && errBody.error) message = errBody.error;
    } catch {
      // ignore JSON parse failure, fall back to default message
    }
    logLine('error', message);
    setStatusLamp('failed');
    setSubmitting(false);
    return;
  }

  const { runId } = await runRes.json();
  const events = new EventSource(`/api/progress/${runId}`);

  events.onmessage = (msg) => {
    const event = JSON.parse(msg.data);

    if (event.type === 'manifest-ready') {
      events.close();
      setSubmitting(false);
      if (event.manifest) {
        logLine('run-done', 'Contact sheet ready.');
        setStatusLamp('done');
        renderGallery(event.manifest, runId);
      } else {
        logLine('error', 'Run failed — no output was generated.');
        setStatusLamp('failed');
      }
      return;
    }

    logLine(event.type, event.message || '');
  };

  events.onerror = () => {
    events.close();
    if (progressSection.querySelector('.status-lamp').className.includes('running')) {
      logLine('error', 'Lost connection to the server.');
      setStatusLamp('failed');
    }
    setSubmitting(false);
  };
});

function setSubmitting(isSubmitting) {
  submitBtn.disabled = isSubmitting;
  submitBtn.classList.toggle('spinning', isSubmitting);
  submitBtn.querySelector('.shutter-label').textContent = isSubmitting ? 'Developing…' : 'Develop';
}

function setStatusLamp(state) {
  statusLamp.classList.remove('done', 'failed');
  if (state === 'done') statusLamp.classList.add('done');
  if (state === 'failed') statusLamp.classList.add('failed');
}

function logLine(type, message) {
  const li = document.createElement('li');
  li.className = `evt-${type}`;
  const tag = document.createElement('span');
  tag.className = 'evt-type';
  tag.textContent = type;
  const text = document.createElement('span');
  text.textContent = message;
  li.appendChild(tag);
  li.appendChild(text);
  progressLog.appendChild(li);
  li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderGallery(manifest, runId) {
  gallerySection.hidden = false;
  downloadLink.href = `/api/download/${runId}`;

  let frameDelay = 0;

  for (const page of manifest.pages) {
    const pageBlock = document.createElement('div');
    pageBlock.className = 'page-block';

    const title = document.createElement('h3');
    title.textContent = page.url;
    pageBlock.appendChild(title);

    const strip = document.createElement('div');
    strip.className = 'strip';

    for (const section of page.sections) {
      const frame = document.createElement('div');
      frame.className = 'frame';
      frame.style.animationDelay = `${frameDelay}ms`;
      frameDelay += 60;

      if (section.composite) {
        const img = document.createElement('img');
        img.src = toWebPath(section.composite);
        img.alt = `${section.slug} composite`;
        img.loading = 'lazy';
        frame.appendChild(img);
      } else {
        const missing = document.createElement('div');
        missing.className = 'frame-missing';
        missing.textContent = 'No composite — every viewport failed to capture this section.';
        frame.appendChild(missing);
      }

      const tag = document.createElement('div');
      tag.className = 'frame-tag';
      const slug = document.createElement('span');
      slug.className = 'frame-slug';
      slug.textContent = section.slug;
      const count = document.createElement('span');
      count.textContent = `${Object.keys(section.viewports).length}/4`;
      tag.appendChild(slug);
      tag.appendChild(count);
      frame.appendChild(tag);

      strip.appendChild(frame);
    }

    pageBlock.appendChild(strip);
    galleryContent.appendChild(pageBlock);
  }
}

function toWebPath(absolutePath) {
  const idx = absolutePath.indexOf('/output/');
  return idx >= 0 ? absolutePath.slice(idx) : absolutePath;
}
