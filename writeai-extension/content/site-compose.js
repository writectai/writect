/**
 * Writect compose / reply — chip inside host compose bar + compact control panel.
 */
(function () {
  const HOST = location.hostname || '';
  const SITE = detectSite();
  if (!SITE) return;

  const BTN_ATTR = 'data-writeai-compose-btn';
  const SLOT_ATTR = 'data-writeai-compose-slot';
  const PANEL_ID = 'writeai-compose-panel';
  const PREFS_KEY = 'writeai_compose_prefs';

  const TONES = [
    { id: 'professional', label: 'Professional' },
    { id: 'friendly', label: 'Friendly' },
    { id: 'casual', label: 'Casual' },
    { id: 'formal', label: 'Formal' },
    { id: 'empathetic', label: 'Empathetic' },
    { id: 'direct', label: 'Direct' }
  ];

  const LENGTHS = [
    { id: 'short', label: 'Short' },
    { id: 'medium', label: 'Medium' },
    { id: 'long', label: 'Long' }
  ];

  const QUICK_PROMPTS =
    SITE.mode === 'reply'
      ? [
          { id: 'ack', label: 'Acknowledge', text: 'Acknowledge and confirm you understood.' },
          { id: 'ask', label: 'Ask clarifying Q', text: 'Ask one clear clarifying question.' },
          { id: 'yes', label: 'Agree', text: 'Agree politely and confirm next steps.' },
          { id: 'later', label: 'Need time', text: 'Say you need a bit more time and give a realistic ETA.' }
        ]
      : [
          { id: 'intro', label: 'Intro', text: 'Short professional introduction.' },
          { id: 'follow', label: 'Follow-up', text: 'Polite follow-up asking for a response.' },
          { id: 'offer', label: 'Offer help', text: 'Offer help and suggest a next step.' },
          { id: 'thanks', label: 'Thanks', text: 'Warm thank-you note.' }
        ];

  const DEFAULT_PREFS = {
    tone: 'professional',
    length: SITE.id === 'whatsapp' || SITE.id === 'linkedin' ? 'short' : 'medium',
    model: ''
  };

  let prefs = { ...DEFAULT_PREFS };
  let modelsCache = null;
  let panelCleanup = null;

  chrome.storage.local.get(PREFS_KEY, (data) => {
    if (data?.[PREFS_KEY]) prefs = { ...DEFAULT_PREFS, ...data[PREFS_KEY] };
  });

  function detectSite() {
    if (/mail\.google\.com$/i.test(HOST) || HOST === 'mail.google.com') {
      return { id: 'gmail', label: 'AI Compose', mode: 'compose' };
    }
    if (/web\.whatsapp\.com$/i.test(HOST)) {
      return { id: 'whatsapp', label: 'AI Reply', mode: 'reply' };
    }
    if (/linkedin\.com$/i.test(HOST) || /\.linkedin\.com$/i.test(HOST)) {
      return { id: 'linkedin', label: 'AI Reply', mode: 'reply' };
    }
    if (/outlook\.(live|office|office365)\.com$/i.test(HOST) || /outlook\.com$/i.test(HOST)) {
      return { id: 'outlook', label: 'AI Compose', mode: 'compose' };
    }
    return null;
  }

  function isAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function savePrefs(partial) {
    prefs = { ...prefs, ...partial };
    chrome.storage.local.set({ [PREFS_KEY]: prefs });
  }

  function findComposeEditors() {
    const editors = [];
    if (SITE.id === 'gmail') {
      document
        .querySelectorAll(
          'div[aria-label="Message Body"][contenteditable="true"], div[role="textbox"][aria-label*="Body"], div[role="textbox"][g_editable="true"]'
        )
        .forEach((el) => editors.push(el));
    } else if (SITE.id === 'whatsapp') {
      document
        .querySelectorAll(
          'footer [contenteditable="true"][data-tab], footer div[role="textbox"][contenteditable="true"], #main footer [contenteditable="true"]'
        )
        .forEach((el) => editors.push(el));
    } else if (SITE.id === 'linkedin') {
      document
        .querySelectorAll(
          '.msg-form__contenteditable[contenteditable="true"], div[role="textbox"][contenteditable="true"]'
        )
        .forEach((el) => {
          if (el.closest('.msg-form, .share-box, .comments-comment-box')) editors.push(el);
        });
    } else if (SITE.id === 'outlook') {
      document
        .querySelectorAll(
          'div[aria-label*="Message body"][contenteditable="true"], div[role="textbox"][aria-label*="body" i]'
        )
        .forEach((el) => editors.push(el));
    }
    return editors;
  }

  function resolveMount(editor) {
    if (SITE.id === 'whatsapp') {
      const footer = editor.closest('footer') || document.querySelector('#main footer');
      if (!footer) return null;

      const send =
        footer.querySelector('[data-testid="compose-btn-send"]') ||
        footer.querySelector('[data-icon="send"]')?.closest('button, [role="button"]') ||
        footer.querySelector('button[aria-label*="Send" i]');
      const mic =
        footer.querySelector('[data-testid="compose-btn-ptt"]') ||
        footer.querySelector('[data-icon="ptt"]')?.closest('button, [role="button"]') ||
        footer.querySelector('button[aria-label*="Voice" i]');
      const trailing = send || mic;

      // Climb until we find the footer row that holds BOTH the compose field and mic/send
      // so the chip sits as a sibling of the grey pill — not cramped inside the mic cell.
      if (trailing) {
        let node = trailing;
        while (node && node !== footer) {
          const parent = node.parentElement;
          if (!parent || parent === footer) break;
          if (parent.contains(editor)) {
            return { parent, before: node, siteClass: 'wa-slot-whatsapp' };
          }
          node = parent;
        }
        if (trailing.parentElement) {
          return { parent: trailing.parentElement, before: trailing, siteClass: 'wa-slot-whatsapp' };
        }
      }

      return { parent: footer, before: null, siteClass: 'wa-slot-whatsapp', append: true };
    }

    if (SITE.id === 'gmail') {
      const dialog = editor.closest('[role="dialog"]') || editor.closest('.M9') || editor.closest('form');
      const sendRow = dialog?.querySelector('.btC, .gU.Up') || null;
      // Main Send only — not "More send options"
      const send =
        dialog?.querySelector(
          '[role="button"][aria-label="Send"], div[aria-label="Send"][role="button"]'
        ) ||
        [...(dialog?.querySelectorAll('[role="button"][aria-label*="Send" i]') || [])].find(
          (el) => {
            const a = (el.getAttribute('aria-label') || '').toLowerCase();
            return a === 'send' || (a.startsWith('send') && !/option|more|schedule/i.test(a));
          }
        ) ||
        null;

      if (send?.parentElement) {
        // Keep Send + chevron together; mount AFTER the whole send group
        const moreSend =
          send.parentElement.querySelector(
            '[aria-label*="More send" i], [aria-label*="send options" i], [data-tooltip*="More send" i]'
          ) ||
          (send.nextElementSibling?.getAttribute?.('role') === 'button' &&
          (send.nextElementSibling.offsetWidth || 40) <= 44
            ? send.nextElementSibling
            : null);
        const after = moreSend || send;
        return {
          parent: send.parentElement,
          before: after.nextSibling,
          siteClass: 'wa-slot-gmail'
        };
      }
      if (sendRow) return { parent: sendRow, before: null, siteClass: 'wa-slot-gmail', append: true };
      return null;
    }

    if (SITE.id === 'linkedin') {
      const form = editor.closest('.msg-form, .share-box, .comments-comment-box');
      const foot =
        form?.querySelector('.msg-form__footer, .msg-form__right-actions, .share-box__footer') || null;
      if (foot) return { parent: foot, before: null, siteClass: 'wa-slot-linkedin', append: true };
      return editor.parentElement
        ? { parent: editor.parentElement, before: null, siteClass: 'wa-slot-linkedin', append: true }
        : null;
    }

    if (SITE.id === 'outlook') {
      const root = editor.closest('[role="main"], [role="dialog"]') || document.body;
      const send = root.querySelector('[aria-label*="Send" i][role="button"], button[aria-label*="Send" i]');
      if (send?.parentElement) {
        return { parent: send.parentElement, before: send, siteClass: 'wa-slot-outlook' };
      }
      return editor.parentElement
        ? { parent: editor.parentElement, before: null, siteClass: 'wa-slot-outlook', append: true }
        : null;
    }

    return null;
  }

  function editorId(editor) {
    if (!editor.dataset.writeaiEid) {
      editor.dataset.writeaiEid = `e${Math.random().toString(36).slice(2, 9)}`;
    }
    return editor.dataset.writeaiEid;
  }

  function ensureButton(editor) {
    const mount = resolveMount(editor);
    if (!mount?.parent) return;

    const existing = document.querySelector(`[${BTN_ATTR}][data-editor-id="${editorId(editor)}"]`);
    if (existing && mount.parent.contains(existing.closest(`[${SLOT_ATTR}]`) || existing)) return;
    if (existing) existing.closest(`[${SLOT_ATTR}]`)?.remove() || existing.remove();

    let slot = mount.parent.querySelector(`[${SLOT_ATTR}]`);
    if (!slot) {
      slot = document.createElement('div');
      slot.setAttribute(SLOT_ATTR, '1');
      slot.className = `wa-compose-slot ${mount.siteClass || ''}`;
      if (mount.before && mount.before.parentNode === mount.parent) {
        mount.parent.insertBefore(slot, mount.before);
      } else {
        mount.parent.appendChild(slot);
      }
    }

    if (slot.querySelector(`[${BTN_ATTR}]`)) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(BTN_ATTR, '1');
    btn.dataset.editorId = editorId(editor);
    btn.className = 'wa-compose-chip';
    btn.title = SITE.label;
    btn.setAttribute('aria-label', SITE.label);
    btn.innerHTML = `
      <img class="wa-compose-mark" src="${chrome.runtime.getURL('icons/Writect-logo-icon.png')}" alt="" width="24" height="24" aria-hidden="true" />
      <span class="wa-compose-label">${SITE.label}</span>
    `;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPanel(editor);
    });
    slot.appendChild(btn);
  }

  function scan() {
    if (SITE.id === 'whatsapp') {
      // Strip any chip left inside the grey text pill (old buggy mounts)
      document.querySelectorAll(`[${SLOT_ATTR}].wa-slot-whatsapp-inline`).forEach((el) => el.remove());
      document.querySelectorAll(`footer [${SLOT_ATTR}]`).forEach((slot) => {
        const parent = slot.parentElement;
        if (!parent) return;
        const hasEditor = !!parent.querySelector(':scope > [contenteditable="true"], :scope > [role="textbox"]');
        const hasMic = !!parent.querySelector('[data-icon="ptt"], [data-icon="send"], [data-testid="compose-btn-ptt"], [data-testid="compose-btn-send"]');
        if (hasEditor && !hasMic) slot.remove();
      });
    }
    findComposeEditors().forEach((editor) => ensureButton(editor));
  }

  function getThreadContext() {
    try {
      if (SITE.id === 'whatsapp') {
        const nodes = [
          ...document.querySelectorAll(
            '#main .copyable-text, #main [data-testid="msg-container"] .selectable-text'
          )
        ].slice(-8);
        return nodes.map((n) => n.innerText.trim()).filter(Boolean).slice(-5).join('\n\n');
      }
      if (SITE.id === 'gmail') {
        const quoted = document.querySelector('.gmail_quote, blockquote.gmail_quote, .a3s');
        const subject = document.querySelector('input[name="subjectbox"]')?.value || '';
        const body = quoted?.innerText?.trim()?.slice(0, 2500) || '';
        return [subject && `Subject: ${subject}`, body].filter(Boolean).join('\n\n');
      }
      if (SITE.id === 'linkedin') {
        const msgs = [
          ...document.querySelectorAll('.msg-s-event-listitem__body, .msg-s-message-list__event')
        ].slice(-5);
        return msgs.map((m) => m.innerText.trim()).filter(Boolean).join('\n\n');
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  function contextMeta() {
    if (SITE.mode !== 'reply') return 'New draft';
    const ctx = getThreadContext();
    if (!ctx) return 'Reply · this chat';
    const n = ctx.split(/\n\n+/).filter(Boolean).length;
    return `Reply · last ${n} msg${n === 1 ? '' : 's'}`;
  }

  function closePanel() {
    panelCleanup?.();
    panelCleanup = null;
    document.getElementById(PANEL_ID)?.remove();
  }

  async function loadModels() {
    if (modelsCache) return modelsCache;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_MODELS' });
      if (res?.models?.length) {
        modelsCache = res.models;
        if (!prefs.model || !modelsCache.some((m) => m.id === prefs.model)) {
          savePrefs({ model: modelsCache[0].id });
        }
        return modelsCache;
      }
    } catch {
      /* ignore */
    }
    modelsCache = [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', free: true },
      { id: 'gemini-flash-lite-latest', label: 'Gemini Flash Lite', free: true }
    ];
    if (!prefs.model) savePrefs({ model: modelsCache[0].id });
    return modelsCache;
  }

  function toneInstruction(toneId) {
    const map = {
      professional: 'Professional, clear, and polished. No slang.',
      friendly: 'Warm and approachable, still clear.',
      casual: 'Relaxed and conversational, like a natural chat.',
      formal: 'Formal and respectful. No contractions or emoji.',
      empathetic: 'Empathetic and reassuring. Acknowledge feelings first.',
      direct: 'Concise and direct. No filler.'
    };
    return map[toneId] || map.professional;
  }

  function lengthInstruction(len) {
    if (len === 'short') return 'Keep it short — a few sentences max.';
    if (len === 'long') return 'Allow a fuller reply with a bit more detail.';
    return 'Medium length — clear but not wordy.';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  async function openPanel(editor) {
    closePanel();
    const models = await loadModels();
    const context = SITE.mode === 'reply' ? getThreadContext() : '';
    const toneLabel = TONES.find((t) => t.id === prefs.tone)?.label || 'Professional';
    const lengthLabel = LENGTHS.find((l) => l.id === prefs.length)?.label || 'Medium';
    const modelLabel =
      models.find((m) => m.id === prefs.model)?.label || models[0]?.label || 'Model';
    const chevron =
      '<svg class="wa-cp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"/></svg>';

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'wa-compose-panel';
    panel.innerHTML = `
      <div class="wa-cp-glow" aria-hidden="true"></div>
      <header class="wa-cp-head">
        <div class="wa-cp-brand">
          <div>
            <img class="wa-cp-logo" src="${chrome.runtime.getURL('icons/Writect-AI-logo-white.png')}" alt="Writect AI" height="20" />
            <div class="wa-cp-meta">${contextMeta()}</div>
          </div>
        </div>
        <button type="button" class="wa-cp-x" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </header>

      <div class="wa-cp-body">
        <div class="wa-cp-dd-row">
          <div class="wa-cp-dd" data-dd="tone">
            <button type="button" class="wa-cp-dd-btn" aria-haspopup="listbox">
              <span class="wa-cp-dd-k">Tone</span>
              <span class="wa-cp-dd-v" data-dd-value>${escapeHtml(toneLabel)}</span>
              ${chevron}
            </button>
            <div class="wa-cp-dd-menu" role="listbox" hidden>
              ${TONES.map(
                (t) =>
                  `<button type="button" class="wa-cp-dd-opt${prefs.tone === t.id ? ' is-on' : ''}" data-tone="${t.id}" role="option">${t.label}</button>`
              ).join('')}
            </div>
          </div>

          <div class="wa-cp-dd" data-dd="length">
            <button type="button" class="wa-cp-dd-btn" aria-haspopup="listbox">
              <span class="wa-cp-dd-k">Length</span>
              <span class="wa-cp-dd-v" data-dd-value>${escapeHtml(lengthLabel)}</span>
              ${chevron}
            </button>
            <div class="wa-cp-dd-menu" role="listbox" hidden>
              ${LENGTHS.map(
                (l) =>
                  `<button type="button" class="wa-cp-dd-opt${prefs.length === l.id ? ' is-on' : ''}" data-length="${l.id}" role="option">${l.label}</button>`
              ).join('')}
            </div>
          </div>

          <div class="wa-cp-dd wa-cp-dd-wide" data-dd="model">
            <button type="button" class="wa-cp-dd-btn" aria-haspopup="listbox">
              <span class="wa-cp-dd-k">Model</span>
              <span class="wa-cp-dd-v" data-dd-value title="${escapeAttr(modelLabel)}">${escapeHtml(modelLabel)}</span>
              ${chevron}
            </button>
            <div class="wa-cp-dd-menu" role="listbox" hidden>
              ${models
                .map(
                  (m) =>
                    `<button type="button" class="wa-cp-dd-opt${prefs.model === m.id ? ' is-on' : ''}" data-model="${escapeAttr(m.id)}" role="option">${escapeHtml(m.label || m.id)}</button>`
                )
                .join('')}
            </div>
          </div>
        </div>

        <div class="wa-cp-input-wrap">
          <textarea class="wa-cp-input" rows="2" placeholder="${
            SITE.mode === 'reply'
              ? 'What should the reply say? (optional)'
              : 'What should the draft say? (optional)'
          }"></textarea>
          <button type="button" class="wa-cp-voice-btn" data-act="voice" title="Voice → Writing" aria-label="Voice to writing" aria-pressed="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          <div class="wa-cp-dd wa-cp-dd-prompts" data-dd="prompt">
            <button type="button" class="wa-cp-prompt-btn" title="Quick prompts" aria-label="Quick prompts" aria-haspopup="listbox">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8L12 3z"/></svg>
            </button>
            <div class="wa-cp-dd-menu wa-cp-dd-menu-right" role="listbox" hidden>
              ${QUICK_PROMPTS.map(
                (q) =>
                  `<button type="button" class="wa-cp-dd-opt" data-quick="${q.id}" role="option">${q.label}</button>`
              ).join('')}
            </div>
          </div>
        </div>

        <div class="wa-cp-status" hidden></div>
        <div class="wa-cp-result" hidden>
          <div class="wa-cp-result-text"></div>
        </div>
      </div>

      <footer class="wa-cp-actions">
        <button type="button" class="wa-cp-btn ghost" data-act="regen" hidden title="Regenerate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <button type="button" class="wa-cp-btn ghost" data-act="copy" hidden>Copy</button>
        <button type="button" class="wa-cp-btn secondary" data-act="insert" hidden>Insert</button>
        <button type="button" class="wa-cp-btn primary" data-act="generate">
          <span class="wa-cp-gen-label">Generate</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
        </button>
      </footer>
    `;

    document.body.appendChild(panel);
    positionPanel(panel, editor);

    const input = panel.querySelector('.wa-cp-input');
    const status = panel.querySelector('.wa-cp-status');
    const resultWrap = panel.querySelector('.wa-cp-result');
    const resultText = panel.querySelector('.wa-cp-result-text');
    const genBtn = panel.querySelector('[data-act="generate"]');
    const insertBtn = panel.querySelector('[data-act="insert"]');
    const copyBtn = panel.querySelector('[data-act="copy"]');
    const regenBtn = panel.querySelector('[data-act="regen"]');
    let draft = '';
    let lastInstruction = '';
    let currentModel = prefs.model || models[0]?.id || '';

    function closeAllMenus(except) {
      panel.querySelectorAll('.wa-cp-dd').forEach((dd) => {
        if (except && dd === except) return;
        dd.classList.remove('is-open');
        const menu = dd.querySelector('.wa-cp-dd-menu');
        if (menu) menu.hidden = true;
      });
    }

    function wireDropdown(dd, onPick) {
      const btn = dd.querySelector('.wa-cp-dd-btn, .wa-cp-prompt-btn');
      const menu = dd.querySelector('.wa-cp-dd-menu');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const willOpen = !dd.classList.contains('is-open');
        closeAllMenus();
        if (willOpen) {
          dd.classList.add('is-open');
          menu.hidden = false;
        }
      });
      menu.querySelectorAll('.wa-cp-dd-opt').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          menu.querySelectorAll('.wa-cp-dd-opt').forEach((o) => o.classList.remove('is-on'));
          opt.classList.add('is-on');
          const valEl = dd.querySelector('[data-dd-value]');
          if (valEl) {
            valEl.textContent = opt.textContent.trim();
            valEl.title = opt.textContent.trim();
          }
          closeAllMenus();
          onPick(opt);
        });
      });
    }

    wireDropdown(panel.querySelector('[data-dd="tone"]'), (opt) => savePrefs({ tone: opt.dataset.tone }));
    wireDropdown(panel.querySelector('[data-dd="length"]'), (opt) =>
      savePrefs({ length: opt.dataset.length })
    );
    wireDropdown(panel.querySelector('[data-dd="model"]'), (opt) => {
      currentModel = opt.dataset.model;
      savePrefs({ model: currentModel });
    });
    wireDropdown(panel.querySelector('[data-dd="prompt"]'), (opt) => {
      const q = QUICK_PROMPTS.find((x) => x.id === opt.dataset.quick);
      if (!q) return;
      input.value = q.text;
      input.focus();
    });

    const onDocClick = (e) => {
      if (!panel.contains(e.target)) closeAllMenus();
    };
    document.addEventListener('click', onDocClick, true);
    panelCleanup = () => document.removeEventListener('click', onDocClick, true);

    panel.querySelector('.wa-cp-x').addEventListener('click', closePanel);
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (panel.querySelector('.wa-cp-dd.is-open')) {
          closeAllMenus();
          return;
        }
        closePanel();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        genBtn.click();
      }
    });

    async function generate(forceRefresh = false) {
      if (!isAlive()) {
        status.hidden = false;
        status.textContent = 'Writect was updated. Refresh this page to continue.';
        return;
      }

      const instruction = (input.value || '').trim();
      lastInstruction = instruction;
      const model = currentModel || prefs.model;

      status.hidden = false;
      status.innerHTML = '<span class="wa-cp-spin"></span> Writing…';
      resultWrap.hidden = true;
      insertBtn.hidden = true;
      copyBtn.hidden = true;
      regenBtn.hidden = true;
      genBtn.disabled = true;
      genBtn.querySelector('.wa-cp-gen-label').textContent = 'Writing…';

      const text =
        SITE.mode === 'reply'
          ? `Write a reply ready to send in this chat.\n\nIncoming messages:\n${context || '(no thread context found)'}\n\nInstruction: ${instruction || 'Polite, clear reply that fits the conversation.'}`
          : `Write a message ready to send.\n\nInstruction: ${instruction || 'Professional short message.'}`;

      const extra = [
        `Tone: ${toneInstruction(prefs.tone)}`,
        lengthInstruction(prefs.length),
        'Plain text only. No markdown. No bullet lists unless asked.',
        'No large blank lines — at most one blank line between paragraphs.',
        SITE.id === 'gmail' || SITE.id === 'outlook'
          ? 'For email: put the subject on the FIRST line exactly as "Subject: ..." then a blank line, then the email body only (no "Subject:" repeated in the body).'
          : '',
        SITE.id === 'whatsapp' || SITE.id === 'linkedin'
          ? 'Prefer chat-friendly line breaks (single newlines).'
          : 'Finish with a short sign-off if appropriate.'
      ].filter(Boolean).join(' ');

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'RUN_ACTION',
          action: 'chat',
          text,
          extra,
          model,
          length: prefs.length,
          forceRefresh,
          source: 'compose'
        });
        if (response?.error || !response?.result) {
          status.textContent =
            response?.message || 'Could not generate. Sign in via the Writect popup if needed.';
          return;
        }
        draft = String(response.result || '')
          .replace(/\r\n/g, '\n')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (/whatsapp|linkedin/i.test(HOST)) draft = draft.replace(/\n{2,}/g, '\n');
        status.hidden = true;
        resultWrap.hidden = false;
        resultText.textContent = draft;
        insertBtn.hidden = false;
        copyBtn.hidden = false;
        regenBtn.hidden = false;
        requestAnimationFrame(() => positionPanel(panel, editor));
      } catch (err) {
        status.textContent = /context invalidated/i.test(err?.message || '')
          ? 'Writect was updated. Refresh this page to continue.'
          : 'Could not reach Writect. Try again.';
      } finally {
        genBtn.disabled = false;
        genBtn.querySelector('.wa-cp-gen-label').textContent = 'Generate';
      }
    }

    genBtn.addEventListener('click', () => generate(false));
    regenBtn.addEventListener('click', () => {
      if (lastInstruction !== undefined) input.value = lastInstruction;
      generate(true);
    });
    insertBtn.addEventListener('click', () => {
      if (!draft) return;
      insertIntoEditor(editor, draft);
      closePanel();
    });
    copyBtn.addEventListener('click', async () => {
      if (!draft) return;
      try {
        await navigator.clipboard.writeText(draft);
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 1200);
      } catch {
        copyBtn.textContent = 'Failed';
      }
    });

    const voiceBtn = panel.querySelector('[data-act="voice"]');
    let voiceSession = null;
    let voiceBusy = false;

    async function polishVoiceDraft(transcript) {
      if (!transcript || voiceBusy) return;
      voiceBusy = true;
      status.hidden = false;
      status.innerHTML = '<span class="wa-cp-spin"></span> Polishing draft…';
      resultWrap.hidden = true;
      insertBtn.hidden = true;
      copyBtn.hidden = true;
      regenBtn.hidden = true;
      genBtn.disabled = true;

      const extra = [
        `Tone: ${toneInstruction(prefs.tone)}`,
        lengthInstruction(prefs.length),
        'Plain text only. No markdown.',
        'Ready to send in this chat.'
      ].join(' ');

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'RUN_ACTION',
          action: 'voice_write',
          text: transcript,
          extra,
          model: currentModel || prefs.model,
          length: prefs.length,
          source: 'compose'
        });
        if (response?.error || !response?.result) {
          status.textContent =
            response?.message || 'Could not polish voice draft. Sign in via the Writect popup if needed.';
          return;
        }
        draft = String(response.result || '')
          .replace(/\r\n/g, '\n')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (/whatsapp|linkedin/i.test(HOST)) draft = draft.replace(/\n{2,}/g, '\n');
        input.value = draft;
        lastInstruction = transcript;
        status.hidden = true;
        resultWrap.hidden = false;
        resultText.textContent = draft;
        insertBtn.hidden = false;
        copyBtn.hidden = false;
        regenBtn.hidden = false;
        requestAnimationFrame(() => positionPanel(panel, editor));
      } catch (err) {
        status.textContent = /context invalidated/i.test(err?.message || '')
          ? 'Writect was updated. Refresh this page to continue.'
          : 'Could not reach Writect. Try again.';
      } finally {
        voiceBusy = false;
        genBtn.disabled = false;
      }
    }

    voiceBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!window.WriteAIVoice?.isSupported?.()) {
        status.hidden = false;
        status.textContent = 'Voice dictation needs Chrome speech support on this page.';
        return;
      }
      if (voiceSession?.listening) {
        voiceSession.stop();
        return;
      }
      status.hidden = false;
      status.textContent = 'Allow microphone, then speak…';
      voiceSession = window.WriteAIVoice.createSession({
        onStart() {
          voiceBtn.classList.add('is-listening');
          voiceBtn.setAttribute('aria-pressed', 'true');
          status.hidden = false;
          status.textContent = 'Listening… speak, then tap the mic to stop.';
        },
        onResult(text) {
          if (text) input.value = text;
        },
        onError(code) {
          voiceBtn.classList.remove('is-listening');
          voiceBtn.setAttribute('aria-pressed', 'false');
          status.hidden = false;
          status.textContent = code === 'not-allowed' || code === 'service-not-allowed'
            ? 'Microphone permission blocked. Allow mic access and try again.'
            : 'Could not capture voice. Try again.';
        },
        onEnd(finalText) {
          voiceBtn.classList.remove('is-listening');
          voiceBtn.setAttribute('aria-pressed', 'false');
          const transcript = (finalText || input.value || '').trim();
          if (transcript) polishVoiceDraft(transcript);
          else {
            status.hidden = false;
            status.textContent = 'No speech captured. Tap mic, allow microphone, speak, then tap again to stop.';
          }
        }
      });
      await voiceSession.start();
    });

    input.focus();
  }

  function positionPanel(panel, editor) {
    const margin = 12;
    const pw = Math.min(panel.offsetWidth || 440, window.innerWidth - margin * 2);
    panel.style.width = `${pw}px`;
    panel.style.maxHeight = `${window.innerHeight - margin * 2}px`;

    const ph = panel.offsetHeight || 380;
    let left = margin;
    let top = margin;

    try {
      const anchor =
        document.querySelector(`[${BTN_ATTR}]`) || editor;
      const rect = anchor.getBoundingClientRect();
      left = Math.min(rect.right - pw, window.innerWidth - pw - margin);
      // Prefer above the compose bar
      top = rect.top - ph - 12;
      if (top < margin) top = Math.min(rect.bottom + 12, window.innerHeight - ph - margin);
    } catch {
      left = window.innerWidth - pw - margin;
      top = window.innerHeight - ph - margin;
    }

    if (left < margin) left = margin;
    if (left + pw > window.innerWidth - margin) left = window.innerWidth - pw - margin;
    if (top < margin) top = margin;
    if (top + ph > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - ph - margin);
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function parseEmailDraft(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!raw) return { subject: '', body: '' };

    const lines = raw.split(/\r?\n/);
    let subject = '';
    let start = 0;

    // "Subject: ..." on first non-empty line (optionally after Re:/Fwd:)
    for (let i = 0; i < Math.min(lines.length, 4); i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = line.match(/^(?:subject)\s*:\s*(.+)$/i);
      if (m) {
        subject = m[1].trim();
        start = i + 1;
        while (start < lines.length && !lines[start].trim()) start += 1;
        break;
      }
      break;
    }

    const body = lines.slice(start).join('\n').replace(/^\n+/, '').trimEnd();
    return { subject, body: body || raw };
  }

  function setGmailSubject(subject) {
    if (!subject || SITE.id !== 'gmail') return false;
    const selectors = [
      'input[name="subjectbox"]',
      'input[aria-label="Subject"]',
      'input[placeholder="Subject"]',
      '.aoT input',
      'form input[name="subject"]'
    ];
    let input = null;
    for (const sel of selectors) {
      input = document.querySelector(sel);
      if (input) break;
    }
    if (!input) return false;

    input.focus();
    input.value = subject;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // Gmail sometimes needs InputEvent for React-like handlers
    try {
      input.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: subject })
      );
    } catch {
      /* ignore */
    }
    return true;
  }

  function setOutlookSubject(subject) {
    if (!subject || SITE.id !== 'outlook') return false;
    const input =
      document.querySelector('input[aria-label="Add a subject"]')
      || document.querySelector('input[placeholder*="Subject" i]')
      || document.querySelector('[aria-label*="Subject" i] input');
    if (!input) return false;
    input.focus();
    input.value = subject;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function insertIntoEditor(editor, text) {
    if (!editor) return;

    let body = String(text || '');
    if (SITE.id === 'gmail' || SITE.id === 'outlook') {
      const parsed = parseEmailDraft(body);
      if (parsed.subject) {
        if (SITE.id === 'gmail') setGmailSubject(parsed.subject);
        else setOutlookSubject(parsed.subject);
      }
      body = parsed.body;
    }

    editor.focus();
    const sel = window.getSelection();
    try {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      /* ignore */
    }

    try {
      if (document.execCommand('insertText', false, body)) {
        editor.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: body })
        );
        return;
      }
    } catch {
      /* fall through */
    }

    const frag = document.createDocumentFragment();
    body.split('\n').forEach((part, i) => {
      if (i) frag.appendChild(document.createElement('br'));
      if (part) frag.appendChild(document.createTextNode(part));
    });
    const r = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (r) {
      r.deleteContents();
      r.insertNode(frag);
    } else {
      editor.appendChild(frag);
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: body }));
  }

  scan();
  const obs = new MutationObserver(() => {
    if (ensureButton._t) cancelAnimationFrame(ensureButton._t);
    ensureButton._t = requestAnimationFrame(scan);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 2000);
})();
