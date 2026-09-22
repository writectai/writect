const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../src/web/public/index.html');
let html = fs.readFileSync(file, 'utf8');

function takeSection(src, re) {
  const m = src.match(re);
  if (!m) throw new Error('Missing section: ' + re);
  return m[0];
}

const hero = takeSection(html, /<section class="hero">[\s\S]*?<\/section>/);
const marquee = takeSection(html, /<section class="marquee-section">[\s\S]*?<\/section>/);
const demos = takeSection(html, /<section class="demos-section"[\s\S]*?<\/section>/);
const pageAssistant = takeSection(html, /<section class="page-assistant"[\s\S]*?<\/section>/);
const ctaInline = takeSection(html, /<section class="cta-inline">[\s\S]*?<\/section>/);
const integrations = takeSection(html, /<section class="integrations"[\s\S]*?<\/section>/);
const why = takeSection(html, /<section class="why-choose"[\s\S]*?<\/section>/);
const features = takeSection(html, /<section class="features"[\s\S]*?<\/section>/);
const how = takeSection(html, /<section class="how">[\s\S]*?<\/section>/);
const testimonials = takeSection(html, /<section class="testimonials"[\s\S]*?<\/section>/);
const pricing = takeSection(html, /<section class="pricing"[\s\S]*?<\/section>/);
const ctaLamp = takeSection(html, /<section class="cta-lamp"[\s\S]*?<\/section>/);

const pageAssistantNew = pageAssistant
  .replace(
    `<div class="container page-assistant-grid reveal">
      <div class="page-assistant-copy">
        <span class="section-label">Page Assistant</span>
        <h2 class="section-title">A sidebar for the whole page — not just a selection.</h2>
        <p class="section-sub" style="margin:0">`,
    `<div class="container reveal">
      <div class="page-assistant-head">
        <h2 class="section-title">From Long Texts to Simple Summaries.</h2>
        <p class="section-sub">A sidebar for the whole page — not just a selection.</p>
      </div>
      <div class="page-assistant-grid">
      <div class="page-assistant-copy">
        <p class="section-sub" style="margin:0">`
  )
  .replace(
    `      </div>
    </div>
  </section>`,
    `      </div>
      </div>
    </div>
  </section>`
  );

if (!pageAssistantNew.includes('page-assistant-head')) {
  throw new Error('Page assistant header replace failed');
}

const faqMatch = pricing.match(/\s*<div class="pricing-faqs">[\s\S]*?<\/div>\s*(?=\s*<\/div>\s*<\/section>)/);
if (!faqMatch) throw new Error('FAQs not found in pricing');

let pricingNew = pricing.replace(faqMatch[0], '\n');
pricingNew = pricingNew.replace(
  '<h2 class="section-title">Write better with a plan that fits</h2>',
  '<h2 class="section-title">Write better with a plan that&nbsp;fits</h2>'
);

const faqsInner = faqMatch[0]
  .trim()
  .replace('pricing-faqs', 'faqs-list')
  .replace(/pricing-faq/g, 'faq-item');

const faqsSection = `  <section class="faqs" id="faqs">
    <div class="container reveal">
      <div class="faqs-head">
        <span class="section-label">FAQs</span>
        <h2 class="section-title">Questions, answered</h2>
        <p class="section-sub">Quick answers about plans, billing, and where Writect works.</p>
      </div>
      ${faqsInner}
    </div>
  </section>`;

const mid = [
  hero,
  marquee,
  demos,
  how,
  pageAssistantNew,
  integrations,
  features,
  why,
  testimonials,
  pricingNew,
  faqsSection,
  ctaInline,
  ctaLamp,
].join('\n\n');

const startIdx = html.indexOf('<section class="hero">');
const footerIdx = html.indexOf('<footer class="landing-footer">');
if (startIdx < 0 || footerIdx < 0) throw new Error('Could not find hero/footer bounds');

const out = html.slice(0, startIdx) + mid + '\n\n  ' + html.slice(footerIdx);
fs.writeFileSync(file, out);

const order = [...out.matchAll(/<section class="([^"\s]+)/g)].map((m) => m[1]);
console.log('OK');
console.log(order.join(' -> '));
