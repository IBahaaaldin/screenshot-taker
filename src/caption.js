const HASHTAGS = '#webdesign #restaurant #instagood #foodie #smallbusiness';
const GENERIC_SLUG = /^section-\d+$/;

export function generateCaption({ siteName, pageUrl, slug }) {
  const heading = GENERIC_SLUG.test(slug) ? pageHeading(pageUrl) : slug;
  return `${siteName} — ${heading}\n\n${HASHTAGS}`;
}

function pageHeading(pageUrl) {
  const { pathname } = new URL(pageUrl);
  const base = pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  return base === '' || base === 'index' ? 'home' : base;
}
