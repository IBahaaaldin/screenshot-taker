// public/app.js
const form = document.getElementById('run-form');
const sourceType = document.getElementById('sourceType');
const sourceLabel = document.getElementById('sourceLabel');
const sourceValue = document.getElementById('sourceValue');
const previewLiveBtn = document.getElementById('preview-live-btn');
const modeSelect = document.getElementById('mode');
const selectorsRow = document.getElementById('selectorsRow');
const submitBtn = document.getElementById('submit-btn');
const progressSection = document.getElementById('progress');
const progressLog = document.getElementById('progress-log');
const statusLamp = document.getElementById('status-lamp');
const gallerySection = document.getElementById('gallery');
const galleryContent = document.getElementById('gallery-content');
const downloadLink = document.getElementById('download-link');

const galleryToolbar = document.getElementById('gallery-toolbar');
const galleryFilter = document.getElementById('gallery-filter');
const galleryExpandAll = document.getElementById('gallery-expand-all');
const galleryCollapseAll = document.getElementById('gallery-collapse-all');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');

const queueContent = document.getElementById('queue-content');
const captionModal = document.getElementById('caption-modal');
const captionModalTitle = document.getElementById('caption-modal-title');
const captionText = document.getElementById('caption-text');
const captionCancel = document.getElementById('caption-cancel');
const captionSubmit = document.getElementById('caption-submit');
const captionError = document.getElementById('caption-error');

let pendingPost = null; // { siteName, pageUrl, kind, images } awaiting caption confirmation

const SOURCE_PLACEHOLDERS = {
  url: { label: 'Source URL', placeholder: 'https://example.com' },
  localFolder: { label: 'Local folder path', placeholder: '/Users/you/projects/my-site' },
};

function updatePreviewBtnState() {
  previewLiveBtn.disabled = sourceType.value !== 'url';
}

sourceType.addEventListener('change', () => {
  const cfg = SOURCE_PLACEHOLDERS[sourceType.value];
  sourceLabel.textContent = cfg.label;
  sourceValue.placeholder = cfg.placeholder;
  updatePreviewBtnState();
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
    autoPost: document.getElementById('autoPost').checked,
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

  let runInFlight = true;

  let runId;
  try {
    ({ runId } = await runRes.json());
  } catch (err) {
    logLine('error', `Server returned an unreadable response — ${err.message}`);
    setStatusLamp('failed');
    setSubmitting(false);
    return;
  }

  const events = new EventSource(`/api/progress/${runId}`);

  events.onmessage = (msg) => {
    const event = JSON.parse(msg.data);

    if (event.type === 'manifest-ready') {
      runInFlight = false;
      events.close();
      setSubmitting(false);
      if (event.manifest) {
        setStatusLamp('done');
        renderGallery(event.manifest, runId);
      } else {
        logLine('error', 'Run failed — no output was generated.');
        setStatusLamp('failed');
      }
      refreshQueue().catch(() => {});
      return;
    }

    logLine(event.type, event.message || '');
  };

  events.onerror = () => {
    events.close();
    if (runInFlight) {
      runInFlight = false;
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

function draftCaption({ siteName, pageUrl, slug }) {
  const HASHTAGS = [
    '#WebDesign', '#ResponsiveDesign', '#UIUXDesign', '#FrontendDevelopment',
    '#WebDeveloper', '#FreelanceDesigner', '#WebsiteLaunch', '#CleanUI',
    '#ModernDesign', '#WebDevLife', '#DigitalMarketing', '#SmallBusinessWebsite',
    '#BrandIdentity', '#CreativeCoding', '#WebsiteForBusiness', '#StartupWebsite',
    '#ProfessionalPortfolio', '#DesignForBusiness', '#WebsiteDesign', '#UXDesign',
  ].join(' ');

  const generic = /^section-\d+$/.test(slug);
  let heading = slug;
  if (generic) {
    const { pathname } = new URL(pageUrl);
    const base = pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
    heading = base === '' || base === 'index' ? 'home' : base;
  }

  return [
    `🔥 Just Delivered: ${siteName}, Digitally Served`,
    '',
    `Proud to unveil the latest build — a custom ${heading} experience for ${siteName}, crafted to turn visitors into customers.`,
    '',
    "This isn't just a website — it's a digital storefront where every scroll, tap, and swipe was designed on purpose. Built to feel as good on a phone as it does on a 27\" monitor.",
    '',
    '✨ Features include:',
    '✅ Fully responsive design (desktop → tablet → mobile)',
    '✅ Clean, modern UI with a layout that actually converts',
    '✅ Fast load times & SEO-friendly structure',
    '✅ Built for real businesses — not just portfolios',
    '',
    '💡 Ready to go live and start turning browsers into customers.',
    '',
    "👉 Want a website like this for your business? Let's talk — DM me or check the link in bio.",
    '',
    HASHTAGS,
  ].join('\n');
}

function openCaptionModal({ siteName, pageUrl, kind, images, slugForDraft }) {
  pendingPost = { siteName, pageUrl, kind, images };
  captionModalTitle.textContent = kind === 'carousel' ? 'Post page as carousel' : 'Post section';
  captionText.value = draftCaption({ siteName, pageUrl, slug: slugForDraft });
  captionError.hidden = true;
  captionModal.hidden = false;
  captionText.focus();
}

function closeCaptionModal() {
  captionModal.hidden = true;
  pendingPost = null;
}

captionCancel.addEventListener('click', closeCaptionModal);

captionSubmit.addEventListener('click', async () => {
  if (!pendingPost) return;
  captionSubmit.disabled = true;
  captionSubmit.classList.add('spinning');
  captionError.hidden = true;

  try {
    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...pendingPost, caption: captionText.value }),
    });
    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || `Request failed (status ${res.status})`);
    }
    closeCaptionModal();
    await refreshQueue();
  } catch (err) {
    captionError.textContent = err.message;
    captionError.hidden = false;
  } finally {
    captionSubmit.disabled = false;
    captionSubmit.classList.remove('spinning');
  }
});

async function refreshQueue() {
  const res = await fetch('/api/queue');
  const { items } = await res.json();
  renderQueue(items);
}

function renderQueue(items) {
  queueContent.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'queue-empty';
    empty.textContent = 'Nothing posted yet.';
    queueContent.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'queue-row';

    const status = document.createElement('span');
    status.className = `queue-status queue-status-${item.status}`;
    status.textContent = item.status;

    const label = document.createElement('span');
    label.className = 'queue-label';
    label.textContent = `${item.siteName} — ${item.kind === 'carousel' ? 'carousel' : 'single'}`;

    row.appendChild(status);
    row.appendChild(label);

    if (item.status === 'queued') {
      const scheduledMs = Date.parse(item.scheduledFor);
      if (Number.isFinite(scheduledMs) && scheduledMs > Date.now()) {
        const when = document.createElement('span');
        when.className = 'queue-scheduled';
        when.textContent = `posts ${new Date(scheduledMs).toLocaleString()}`;
        row.appendChild(when);
      }
    }

    if (item.status === 'failed' && item.error) {
      const err = document.createElement('span');
      err.className = 'queue-error';
      err.textContent = item.error;
      row.appendChild(err);
    }

    queueContent.appendChild(row);
  }
}

function renderGallery(manifest, runId) {
  gallerySection.hidden = false;
  galleryToolbar.hidden = manifest.pages.length <= 1;
  downloadLink.href = `/api/download/${runId}`;

  let frameDelay = 0;
  const collapseByDefault = manifest.pages.length > 3;

  manifest.pages.forEach((page, pageIndex) => {
    const pageBlock = document.createElement('div');
    pageBlock.className = 'page-block';
    if (collapseByDefault && pageIndex > 0) pageBlock.classList.add('collapsed');
    pageBlock.dataset.url = page.url.toLowerCase();

    const header = document.createElement('div');
    header.className = 'page-block-header';
    header.addEventListener('click', () => pageBlock.classList.toggle('collapsed'));

    const toggle = document.createElement('span');
    toggle.className = 'page-block-toggle';
    toggle.textContent = '▾';
    header.appendChild(toggle);

    const title = document.createElement('h3');
    title.textContent = page.url;
    header.appendChild(title);

    pageBlock.appendChild(header);

    const pageComposites = page.sections.filter((s) => s.composite).map((s) => s.composite);
    if (pageComposites.length > 1) {
      const carouselImages = pageComposites.slice(0, 10);
      const carouselBtn = document.createElement('button');
      carouselBtn.type = 'button';
      carouselBtn.className = 'page-carousel-btn';
      carouselBtn.textContent =
        pageComposites.length > 10
          ? `Post first 10 of ${pageComposites.length} as carousel`
          : `Post all ${pageComposites.length} as carousel`;
      carouselBtn.addEventListener('click', () =>
        openCaptionModal({
          siteName: manifest.site,
          pageUrl: page.url,
          kind: 'carousel',
          images: carouselImages,
          slugForDraft: page.sections[0].slug,
        })
      );
      pageBlock.appendChild(carouselBtn);
    }

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
        img.addEventListener('click', () => openLightbox(img.src, img.alt));
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

      if (section.composite) {
        const postBtn = document.createElement('button');
        postBtn.type = 'button';
        postBtn.className = 'frame-post-btn';
        postBtn.textContent = 'Post';
        postBtn.addEventListener('click', () =>
          openCaptionModal({
            siteName: manifest.site,
            pageUrl: page.url,
            kind: 'single',
            images: [section.composite],
            slugForDraft: section.slug,
          })
        );
        frame.appendChild(postBtn);
      }

      if (section.splitCrop) {
        const splitRow = document.createElement('div');
        splitRow.className = 'split-crop-row';

        for (const [label, imgPath] of [
          ['left', section.splitCrop.left],
          ['right', section.splitCrop.right],
        ]) {
          const splitCard = document.createElement('div');
          splitCard.className = 'split-crop-card';

          const splitImg = document.createElement('img');
          splitImg.src = toWebPath(imgPath);
          splitImg.alt = `${section.slug} composite — ${label} half`;
          splitImg.loading = 'lazy';
          splitImg.addEventListener('click', () => openLightbox(splitImg.src, splitImg.alt));
          splitCard.appendChild(splitImg);

          const splitLabel = document.createElement('span');
          splitLabel.className = 'split-crop-label';
          splitLabel.textContent = label;
          splitCard.appendChild(splitLabel);

          const downloadLink = document.createElement('a');
          downloadLink.href = toWebPath(imgPath);
          downloadLink.download = '';
          downloadLink.className = 'split-crop-download';
          downloadLink.textContent = 'Download';
          splitCard.appendChild(downloadLink);

          splitRow.appendChild(splitCard);
        }

        frame.appendChild(splitRow);
      }

      strip.appendChild(frame);
    }

    pageBlock.appendChild(strip);
    galleryContent.appendChild(pageBlock);
  });
}

function toWebPath(absolutePath) {
  const idx = absolutePath.indexOf('/output/');
  return idx >= 0 ? absolutePath.slice(idx) : absolutePath;
}

function openLightbox(src, alt) {
  lightboxImg.src = src;
  lightboxImg.alt = alt || '';
  lightbox.hidden = false;
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.src = '';
}

lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
lightboxClose.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
});

galleryFilter.addEventListener('input', () => {
  const query = galleryFilter.value.trim().toLowerCase();
  for (const pageBlock of galleryContent.querySelectorAll('.page-block')) {
    pageBlock.hidden = query.length > 0 && !pageBlock.dataset.url.includes(query);
  }
});

galleryExpandAll.addEventListener('click', () => {
  for (const pageBlock of galleryContent.querySelectorAll('.page-block')) {
    pageBlock.classList.remove('collapsed');
  }
});

galleryCollapseAll.addEventListener('click', () => {
  for (const pageBlock of galleryContent.querySelectorAll('.page-block')) {
    pageBlock.classList.add('collapsed');
  }
});

previewLiveBtn?.addEventListener('click', () => {
  const value = sourceValue.value.trim();
  if (!value) {
    sourceValue.focus();
    return;
  }
  const previewUrlInput = document.getElementById('preview-url');
  const previewForm = document.getElementById('preview-form');
  if (!previewUrlInput || !previewForm) return;
  previewUrlInput.value = value;
  previewForm.requestSubmit();
  previewUrlInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

updatePreviewBtnState();
refreshQueue();
