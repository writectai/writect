/**
 * Page text extraction for the WriteAI side panel only.
 * Does not touch the selection toolbar (content.js) or compose chips.
 */
(function () {
  if (window.__writeaiPageExtractInstalled) return;
  window.__writeaiPageExtractInstalled = true;

  const MAX_CHARS = 48000;
  // Avoid stripping aside/complementary — many marketing sites put hero copy there.
  const NOISE_SELECTORS = [
    'script', 'style', 'noscript', 'svg', 'iframe', 'canvas', 'video', 'audio',
    'object', 'embed', 'link', 'meta', 'template',
    'nav', 'footer',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[aria-hidden="true"]',
    '#writeai-toolbar', '#writeai-compose-panel',
    '[data-writeai-compose-btn]', '[data-writeai-compose-slot]',
    '.cookie', '.cookies', '#cookie', '#cookies',
    '.cookie-banner', '.cookie-consent', '#onetrust-banner-sdk',
    '.advertisement', '.ads', '.ad-slot'
  ].join(',');

  function visibleTextLength(el) {
    if (!el) return 0;
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return 0;
    } catch {
      /* ignore */
    }
    return (el.innerText || '').replace(/\s+/g, ' ').trim().length;
  }

  function pickBestRoot() {
    const candidates = [
      document.querySelector('article'),
      document.querySelector('[role="main"]'),
      document.querySelector('main'),
      document.querySelector('#content, #main, .post-content, .article-body, .entry-content, .page-content, .site-content'),
      ...Array.from(document.querySelectorAll('section, .container, .wrapper, [class*="content"], [class*="section"]')).slice(0, 40)
    ].filter(Boolean);

    let best = document.body;
    let bestScore = visibleTextLength(document.body);
    candidates.forEach((el) => {
      const score = visibleTextLength(el);
      // Prefer substantial content blocks; avoid tiny "main" stubs.
      if (score > bestScore && score >= 400) {
        best = el;
        bestScore = score;
      } else if (best === document.body && score > 400 && score > bestScore * 0.35) {
        best = el;
        bestScore = score;
      }
    });
    return best || document.body;
  }

  function extractFromClone(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll(NOISE_SELECTORS).forEach((el) => el.remove());
    clone.querySelectorAll('[id^="writeai"], [class*="wa-"]').forEach((el) => el.remove());

    return (clone.innerText || clone.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function extractPage() {
    const title = (document.title || '').trim();
    const url = location.href;

    // Try best content root first, then full body if too short.
    let text = extractFromClone(pickBestRoot());
    if (text.length < 500) {
      const bodyText = extractFromClone(document.body);
      if (bodyText.length > text.length) text = bodyText;
    }

    // Last resort: live innerText (some sites hydrate oddly in clones)
    if (text.length < 300) {
      const live = (document.body?.innerText || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (live.length > text.length) text = live;
    }

    let truncated = false;
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS);
      truncated = true;
    }

    return {
      title,
      url,
      text,
      truncated,
      charCount: text.length
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'EXTRACT_PAGE') return undefined;
    try {
      sendResponse({ ok: true, ...extractPage() });
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || 'extract_failed' });
    }
    return false;
  });
})();
