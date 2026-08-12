// public/app.js
const form = document.getElementById('run-form');
const sourceType = document.getElementById('sourceType');
const sourceLabel = document.getElementById('sourceLabel');
const modeSelect = document.getElementById('mode');
const selectorsRow = document.getElementById('selectorsRow');
const progressSection = document.getElementById('progress');
const progressLog = document.getElementById('progress-log');
const gallerySection = document.getElementById('gallery');
const galleryContent = document.getElementById('gallery-content');
const downloadLink = document.getElementById('download-link');

sourceType.addEventListener('change', () => {
  sourceLabel.textContent = sourceType.value === 'url' ? 'URL' : 'Local folder path';
});

modeSelect.addEventListener('change', () => {
  selectorsRow.style.display = modeSelect.value === 'selectors' ? 'block' : 'none';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  progressLog.innerHTML = '';
  galleryContent.innerHTML = '';
  progressSection.hidden = false;
  gallerySection.hidden = true;

  const body = {
    siteName: document.getElementById('siteName').value,
    mode: modeSelect.value,
    selectors: document.getElementById('selectors').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
  const sourceValue = document.getElementById('sourceValue').value;
  if (sourceType.value === 'url') {
    body.url = sourceValue;
  } else {
    body.localFolder = sourceValue;
  }

  const runRes = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!runRes.ok) {
    let message = `Request failed (status ${runRes.status})`;
    try {
      const errBody = await runRes.json();
      if (errBody && errBody.error) message = errBody.error;
    } catch {
      // ignore JSON parse failure, fall back to default message
    }
    const li = document.createElement('li');
    li.textContent = `[error] ${message}`;
    progressLog.appendChild(li);
    return;
  }

  const { runId } = await runRes.json();

  const events = new EventSource(`/api/progress/${runId}`);
  events.onmessage = (msg) => {
    const event = JSON.parse(msg.data);
    const li = document.createElement('li');
    li.textContent = `[${event.type}] ${event.message || ''}`;
    progressLog.appendChild(li);

    if (event.type === 'manifest-ready') {
      if (event.manifest) {
        renderGallery(event.manifest, runId);
      } else {
        const errLi = document.createElement('li');
        errLi.textContent = '[error] Run failed, no output was generated';
        progressLog.appendChild(errLi);
      }
      events.close();
    }
  };
});

function renderGallery(manifest, runId) {
  gallerySection.hidden = false;
  downloadLink.href = `/api/download/${runId}`;

  for (const page of manifest.pages) {
    const pageBlock = document.createElement('div');
    pageBlock.className = 'page-block';
    const title = document.createElement('h3');
    title.textContent = page.url;
    pageBlock.appendChild(title);

    for (const section of page.sections) {
      const sectionBlock = document.createElement('div');
      sectionBlock.className = 'section-block';
      const label = document.createElement('strong');
      label.textContent = section.slug;
      sectionBlock.appendChild(label);

      if (section.composite) {
        const img = document.createElement('img');
        img.src = toWebPath(section.composite);
        sectionBlock.appendChild(img);
      }
      pageBlock.appendChild(sectionBlock);
    }
    galleryContent.appendChild(pageBlock);
  }
}

function toWebPath(absolutePath) {
  const idx = absolutePath.indexOf('/output/');
  return idx >= 0 ? absolutePath.slice(idx) : absolutePath;
}
