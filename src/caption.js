// src/caption.js
const HASHTAGS = [
  '#WebDesign', '#ResponsiveDesign', '#UIUXDesign', '#FrontendDevelopment',
  '#WebDeveloper', '#FreelanceDesigner', '#WebsiteLaunch', '#CleanUI',
  '#ModernDesign', '#WebDevLife', '#DigitalMarketing', '#SmallBusinessWebsite',
  '#BrandIdentity', '#CreativeCoding', '#WebsiteForBusiness', '#StartupWebsite',
  '#ProfessionalPortfolio', '#DesignForBusiness', '#WebsiteDesign', '#UXDesign',
].join(' ');

const GENERIC_SLUG = /^section-\d+$/;

export function generateCaption({ siteName, pageUrl, slug }) {
  const heading = GENERIC_SLUG.test(slug) ? pageHeading(pageUrl) : slug;
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

function pageHeading(pageUrl) {
  const { pathname } = new URL(pageUrl);
  const base = pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  return base === '' || base === 'index' ? 'home' : base;
}
