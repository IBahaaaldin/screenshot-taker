// src/caption.js

// Instagram treats a stream of byte-identical captions as spam, and the same 20
// hashtags in the same order on every post is the strongest version of that
// signal. A run of this tool can produce well over a hundred posts from one
// site, so the copy varies per section: the hook, the closing line, and the
// hashtag selection are all chosen from a hash of the page + section. That
// keeps generation deterministic (same section always yields the same caption,
// which the tests rely on) while making no two posts identical.

const HOOKS = [
  (site) => `🔥 Just Delivered: ${site}, Digitally Served`,
  (site) => `🚀 New Build Live: ${site}`,
  (site) => `✨ Fresh Off The Desk: ${site}`,
  (site) => `📐 Designed & Shipped: ${site}`,
  (site) => `💻 Built From Scratch: ${site}`,
];

const OPENERS = [
  (heading, site) =>
    `Proud to unveil the latest build — a custom ${heading} experience for ${site}, crafted to turn visitors into customers.`,
  (heading, site) =>
    `Here's the ${heading} for ${site} — designed to load fast, read clearly, and convert.`,
  (heading, site) =>
    `A closer look at the ${heading} I built for ${site}. Every detail placed on purpose.`,
  (heading, site) =>
    `${site}'s new ${heading}, built to work as hard on mobile as it does on desktop.`,
];

const BODIES = [
  'This isn\'t just a website — it\'s a digital storefront where every scroll, tap, and swipe was designed on purpose. Built to feel as good on a phone as it does on a 27" monitor.',
  'One layout, four screens. The same care goes into the 390px phone view as the 27" display — because that\'s where most of your customers actually are.',
  'Responsive isn\'t an afterthought here. The grid, the type scale, and the spacing were all built to hold up at every width.',
];

const FEATURE_SETS = [
  [
    '✅ Fully responsive design (desktop → tablet → mobile)',
    '✅ Clean, modern UI with a layout that actually converts',
    '✅ Fast load times & SEO-friendly structure',
    '✅ Built for real businesses — not just portfolios',
  ],
  [
    '✅ Pixel-tight across desktop, tablet and mobile',
    '✅ Type and spacing built on a real scale, not guesswork',
    '✅ Optimised images and fast first paint',
    '✅ Structured for search from day one',
  ],
  [
    '✅ Mobile-first layout that never feels squeezed',
    '✅ Accessible colour contrast and clear tap targets',
    '✅ Clean, maintainable markup underneath',
    '✅ Built to grow with the business',
  ],
];

const CLOSERS = [
  "👉 Want a website like this for your business? Let's talk — DM me or check the link in bio.",
  '👉 Need something similar? DM me — link in bio.',
  "👉 Got a project in mind? My DMs are open, or use the link in bio.",
  '👉 Building something and want it to look like this? Let\'s talk — DM or link in bio.',
];

const HASHTAG_POOL = [
  '#WebDesign', '#ResponsiveDesign', '#UIUXDesign', '#FrontendDevelopment',
  '#WebDeveloper', '#FreelanceDesigner', '#WebsiteLaunch', '#CleanUI',
  '#ModernDesign', '#WebDevLife', '#DigitalMarketing', '#SmallBusinessWebsite',
  '#BrandIdentity', '#CreativeCoding', '#WebsiteForBusiness', '#StartupWebsite',
  '#ProfessionalPortfolio', '#DesignForBusiness', '#WebsiteDesign', '#UXDesign',
];
// Instagram allows 30 but rewards relevance over volume; a rotating dozen keeps
// each post's set distinct without looking stuffed.
const HASHTAGS_PER_POST = 12;

const GENERIC_SLUG = /^section-\d+$/;
// A leading locale segment is routing, not a page name — without stripping it
// the homepage caption read "a custom en experience".
const LOCALE_SEGMENT_RE = /^[a-z]{2}(-[a-z0-9]{2,4})?$/i;

export function generateCaption({ siteName, pageUrl, slug }) {
  const heading = GENERIC_SLUG.test(slug) ? pageHeading(pageUrl) : humanize(slug);
  // siteName is the OUTPUT FOLDER name — its own field is labelled that way and
  // restricted to "letters, numbers, dots, dashes", nothing about it signals to
  // a user that the same string lands verbatim in every public caption. Typing
  // a folder-safe slug like "acme-dental" produced "Just Delivered: acme-dental,
  // Digitally Served" in every post. Humanized the same way a URL path is.
  const displayName = humanize(siteName);
  const seed = hash(`${pageUrl}::${slug}`);
  const pick = (list, offset) => list[(seed + offset) % list.length];

  return [
    pick(HOOKS, 0)(displayName),
    '',
    pick(OPENERS, 1)(heading, displayName),
    '',
    pick(BODIES, 2),
    '',
    '✨ Features include:',
    ...pick(FEATURE_SETS, 3),
    '',
    '💡 Ready to go live and start turning browsers into customers.',
    '',
    pick(CLOSERS, 4),
    '',
    rotatedHashtags(seed),
  ].join('\n');
}

function rotatedHashtags(seed) {
  const start = seed % HASHTAG_POOL.length;
  const out = [];
  for (let i = 0; i < HASHTAGS_PER_POST; i++) {
    out.push(HASHTAG_POOL[(start + i) % HASHTAG_POOL.length]);
  }
  return out.join(' ');
}

// Turns a URL path or selector slug into something readable: "dish-wash" and
// "products/dish_wash" both become "Dish Wash" rather than being dropped into
// the sentence as a raw path.
function humanize(value) {
  const words = String(value)
    .split(/[\/\-_.]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1)));
  return words.join(' ');
}

function pageHeading(pageUrl) {
  const { pathname } = new URL(pageUrl);
  const base = pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  const segments = base.split('/').filter(Boolean);
  if (segments.length > 1 && LOCALE_SEGMENT_RE.test(segments[0])) segments.shift();
  // A path that was nothing but a locale ("/en") is still the home page.
  if (segments.length === 0) return 'home';
  const last = segments[segments.length - 1];
  if (last === 'index' || LOCALE_SEGMENT_RE.test(last)) return 'home';
  return humanize(last);
}

// Small deterministic string hash — only needs to spread variants evenly.
function hash(value) {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) % 100000;
  }
  return h;
}
