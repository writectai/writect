const $ = (id) => document.getElementById(id);

const PRESETS = {
  summarize: {
    label: 'Summary',
    action: 'page_summarize',
    extra: ''
  },
  keypoints: {
    label: 'Key points',
    action: 'page_summarize',
    extra: 'Return 5–8 concise bullet points covering the most important facts and takeaways. Use plain "- " bullets only.'
  },
  simplify: {
    label: 'Simplified',
    action: 'page_summarize',
    extra: 'Rewrite this page in plain, simple language a busy reader can understand quickly. Keep the meaning. Use short paragraphs. Do not invent facts. Avoid jargon unless you briefly explain it.'
  }
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIM = 1280;
const MODEL_PREF_KEY = 'writeaiSidepanelModel';

let pageContext = null;
let busy = false;
let attachments = [];
let modelsList = [];
let selectedModel = '';
/** Prevents double auto-run when init + pending message race. */
let bootActionDone = false;

function setBusy(on) {
  busy = on;
  $('loading').classList.toggle('hidden', !on);
  $('main')?.classList.toggle('is-busy', on);
  document.querySelectorAll('.chip').forEach((el) => {
    el.disabled = on;
  });
  $('ask-btn').disabled = on;
  $('ask-input').disabled = on;
  $('attach-btn').disabled = on;
  if ($('voice-btn')) $('voice-btn').disabled = on;
  $('model-btn').disabled = on;
}

function showError(msg) {
  const el = $('status');
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showResult(text, label) {
  $('result-label').textContent = label || 'Answer';
  const el = $('result');
  const main = $('main');
  if (!text) {
    el.textContent = '';
    $('result-wrap').classList.add('hidden');
    main?.classList.remove('has-answer');
    return;
  }
  el.innerHTML = renderMarkdown(text);
  $('result-wrap').classList.remove('hidden');
  main?.classList.add('has-answer');
  requestAnimationFrame(() => {
    el.scrollTop = 0;
  });
}

function clearAskInput() {
  const input = $('ask-input');
  input.value = '';
  input.style.height = 'auto';
}

function formatCount(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k chars`;
  return `${n} chars`;
}

function shortHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';
  const raw = String(text).replace(/\r\n/g, '\n').trim();
  const lines = raw.split('\n');
  const out = [];
  let inUl = false;
  let inOl = false;

  function closeLists() {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  }

  function inline(s) {
    return escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      closeLists();
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeLists();
      out.push('<hr>');
      continue;
    }

    const h = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    if (trimmed === '>' || trimmed.startsWith('> ')) {
      closeLists();
      const parts = [];
      while (i < lines.length) {
        const q = lines[i].trim();
        if (!(q === '>' || q.startsWith('> '))) break;
        parts.push(q === '>' ? '' : q.replace(/^>\s?/, ''));
        i += 1;
      }
      i -= 1;
      const body = parts.map((p) => inline(p)).filter(Boolean).join('<br>');
      if (body) out.push(`<blockquote><p>${body}</p></blockquote>`);
      continue;
    }

    const ul = trimmed.match(/^[-*]\s+(.+)$/);
    if (ul) {
      if (!inUl) { closeLists(); out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      if (!inOl) { closeLists(); out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    closeLists();
    out.push(`<p>${inline(trimmed)}</p>`);
  }

  closeLists();
  return out.join('') || `<p>${inline(raw)}</p>`;
}

function renderPageMeta(ctx) {
  const dockSub = $('dock-subtitle');
  if (!ctx?.ok) {
    $('page-title').textContent = ctx?.error === 'restricted'
      ? 'This page can’t be read'
      : 'Couldn’t read this page';
    $('page-url').textContent = ctx?.url ? shortHost(ctx.url) : '';
    $('page-stats').textContent = ctx?.message || 'Open a normal website tab and refresh.';
    pageContext = null;
    if (dockSub) dockSub.textContent = 'Waiting for a readable page';
    return;
  }
  pageContext = ctx;
  $('page-title').textContent = ctx.title || 'Untitled page';
  $('page-url').textContent = shortHost(ctx.url);
  const bits = [formatCount(ctx.charCount || 0)];
  if (ctx.truncated) bits.push('truncated');
  $('page-stats').textContent = bits.join(' · ');
  if (dockSub) {
    const host = shortHost(ctx.url);
    dockSub.textContent = host
      ? `Ready on ${host}`
      : 'Summarize · ask · rewrite';
  }
}

function shortModelLabel(label) {
  const s = String(label || 'Model');
  if (s.length <= 18) return s;
  return `${s.slice(0, 16)}…`;
}

function initialsFrom(user) {
  const src = user?.name || user?.email || '?';
  return src.charAt(0).toUpperCase();
}

function closeModelMenu() {
  const menu = $('model-menu');
  const btn = $('model-btn');
  if (!menu || !btn) return;
  menu.classList.add('hidden');
  btn.setAttribute('aria-expanded', 'false');
}

function renderModelMenu() {
  const menu = $('model-menu');
  const labelEl = $('model-btn-label');
  if (!menu || !labelEl) return;

  const current = modelsList.find((m) => m.id === selectedModel) || modelsList[0];
  labelEl.textContent = shortModelLabel(current?.label || current?.id || 'Model');
  labelEl.title = current?.label || current?.id || 'Model';

  if (!modelsList.length) {
    menu.innerHTML = '<div class="model-empty">No models available</div>';
    return;
  }

  menu.innerHTML = modelsList.map((m) => `
    <button type="button" class="model-opt${m.id === selectedModel ? ' is-on' : ''}" data-model="${escapeHtml(m.id)}" role="option">
      <span class="model-opt-label">${escapeHtml(m.label || m.id)}</span>
      ${m.free ? '<span class="model-opt-tag">Free</span>' : '<span class="model-opt-tag pro">Pro</span>'}
    </button>
  `).join('');

  menu.querySelectorAll('[data-model]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      selectedModel = btn.getAttribute('data-model') || '';
      await chrome.storage.local.set({ [MODEL_PREF_KEY]: selectedModel });
      renderModelMenu();
      closeModelMenu();
    });
  });
}

async function loadModels() {
  const stored = await chrome.storage.local.get(MODEL_PREF_KEY);
  selectedModel = stored[MODEL_PREF_KEY] || '';

  const res = await chrome.runtime.sendMessage({ type: 'GET_MODELS' }).catch(() => ({}));
  modelsList = Array.isArray(res?.models) ? res.models : [];

  if (!modelsList.length) {
    modelsList = [
      { id: 'gemini-3.5-flash-lite', label: 'Gemini Flash Lite', free: true },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini', free: true }
    ];
  }

  if (!selectedModel || !modelsList.some((m) => m.id === selectedModel)) {
    selectedModel = modelsList[0].id;
    await chrome.storage.local.set({ [MODEL_PREF_KEY]: selectedModel });
  }

  renderModelMenu();
}

function setAvatarPair(imgEl, fallbackEl, user) {
  const initial = initialsFrom(user);
  fallbackEl.textContent = initial;
  if (user?.avatar_url) {
    imgEl.onerror = () => {
      imgEl.hidden = true;
      fallbackEl.hidden = false;
    };
    imgEl.src = user.avatar_url;
    imgEl.hidden = false;
    fallbackEl.hidden = true;
  } else {
    imgEl.removeAttribute('src');
    imgEl.hidden = true;
    fallbackEl.hidden = false;
  }
}

function closeAccountMenu() {
  const menu = $('account-menu');
  const btn = $('account-btn');
  if (!menu || !btn) return;
  menu.classList.add('hidden');
  btn.setAttribute('aria-expanded', 'false');
}

function toggleAccountMenu() {
  const menu = $('account-menu');
  const btn = $('account-btn');
  const open = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function renderAccount(user) {
  const bar = $('account-bar');
  bar.classList.remove('hidden');

  const signedIn = !!user;
  $('menu-signed-in').classList.toggle('hidden', !signedIn);
  $('menu-signed-out').classList.toggle('hidden', signedIn);

  setAvatarPair($('account-avatar'), $('account-avatar-fallback'), user || { name: '?' });

  if (!signedIn) {
    $('account-avatar-fallback').textContent = '?';
    const dockPlan = $('dock-plan');
    if (dockPlan) dockPlan.classList.add('hidden');
    const dockSub = $('dock-subtitle');
    if (dockSub) dockSub.textContent = 'Sign in to get started';
    return;
  }

  setAvatarPair($('menu-avatar'), $('menu-avatar-fallback'), user);
  const name = user.name || user.email?.split('@')[0] || 'Account';
  $('account-name').textContent = name;
  $('account-email').textContent = user.email || '';
  const first = user.name?.split(' ')[0];
  if ($('greeting')) {
    $('greeting').textContent = first
      ? `Hi, ${first} — what do you need?`
      : 'What do you need from this page?';
  }

  const isPro = user.plan === 'pro';
  const badge = $('plan-badge');
  badge.textContent = isPro ? 'Pro' : 'Free';
  badge.className = `plan-badge ${isPro ? 'plan-pro' : 'plan-free'}`;

  const dockPlan = $('dock-plan');
  if (dockPlan) {
    dockPlan.textContent = isPro ? 'Pro' : 'Free';
    dockPlan.classList.toggle('is-free', !isPro);
    dockPlan.classList.remove('hidden');
  }

  const usageEl = $('menu-usage');
  const usage = user.usage || {};
  const count = usage.count || 0;
  const limit = usage.limit;
  const remaining = usage.remaining != null
    ? usage.remaining
    : (limit != null ? Math.max(0, limit - count) : null);
  const dailyCount = usage.daily_count || 0;
  const dailyLimit = usage.daily_limit;
  const lines = [];
  if (limit != null) {
    let monthly = `Monthly: ${count.toLocaleString()} / ${limit.toLocaleString()}`;
    if (remaining != null) monthly += ` (${remaining.toLocaleString()} left)`;
    lines.push(monthly);
  }
  if (dailyLimit != null) {
    lines.push(`Daily: ${dailyCount.toLocaleString()} / ${dailyLimit.toLocaleString()}`);
  }
  if (lines.length) {
    usageEl.innerHTML = lines.map((l) => `<div class="menu-usage-line">${l}</div>`).join('');
    usageEl.classList.remove('hidden');
  } else {
    usageEl.classList.add('hidden');
    usageEl.textContent = '';
  }

  const hasBilling = !!user.has_billing;
  const upgradeBtn = $('upgrade-btn');
  const manageBtn = $('manage-btn');
  if (isPro) {
    upgradeBtn.classList.add('hidden');
    manageBtn.classList.toggle('hidden', !hasBilling);
  } else {
    upgradeBtn.classList.remove('hidden');
    manageBtn.classList.add('hidden');
  }
}

function setGateMsg(kind, text) {
  const err = $('gate-error');
  const ok = $('gate-success');
  if (err) {
    err.textContent = kind === 'error' ? (text || '') : '';
    err.classList.toggle('hidden', kind !== 'error' || !text);
  }
  if (ok) {
    ok.textContent = kind === 'ok' ? (text || '') : '';
    ok.classList.toggle('hidden', kind !== 'ok' || !text);
  }
}

function setGateMode(mode) {
  setGateMsg('', '');
  $('gate-signin')?.classList.toggle('hidden', mode !== 'signin');
  $('gate-signup')?.classList.toggle('hidden', mode !== 'signup');
  $('gate-forgot')?.classList.toggle('hidden', mode !== 'forgot');
  const title = $('gate-title');
  const sub = $('gate-sub');
  if (mode === 'signup') {
    if (title) title.textContent = 'Create account';
    if (sub) sub.textContent = 'Sign up with email, or continue with Google.';
  } else if (mode === 'forgot') {
    if (title) title.textContent = 'Reset password';
    if (sub) sub.textContent = 'We’ll prepare a reset link for your email.';
  } else {
    if (title) title.textContent = 'Welcome back';
    if (sub) sub.textContent = 'Sign in to summarize pages, ask questions, and attach images or files.';
  }
}

function renderAttachments() {
  const wrap = $('attach-preview');
  if (!attachments.length) {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    return;
  }
  wrap.classList.remove('hidden');
  wrap.innerHTML = attachments.map((a) => `
    <div class="attach-item" data-id="${a.id}">
      ${a.type === 'image' ? `<img src="${a.dataUrl}" alt="">` : '<span>📄</span>'}
      <span class="attach-name">${escapeHtml(a.name)}</span>
      <button class="attach-remove" type="button" data-remove="${a.id}" aria-label="Remove">×</button>
    </div>
  `).join('');

  wrap.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      attachments = attachments.filter((a) => a.id !== btn.dataset.remove);
      renderAttachments();
    });
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
        const scale = MAX_IMAGE_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_load_failed'));
    };
    img.src = url;
  });
}

async function addFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    showError('File must be under 5 MB.');
    return;
  }

  const isImage = file.type.startsWith('image/');
  const isText = /\.(txt|md|csv|json)$/i.test(file.name) || file.type.startsWith('text/');

  if (!isImage && !isText) {
    showError('Supported: images, .txt, .md, .csv, .json');
    return;
  }

  // One image max (vision); text files can stack lightly
  if (isImage) {
    attachments = attachments.filter((a) => a.type !== 'image');
  }
  if (attachments.length >= 3) {
    showError('You can attach up to 3 files.');
    return;
  }

  const item = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name: file.name,
    type: isImage ? 'image' : 'file'
  };

  try {
    if (isImage) {
      item.dataUrl = await compressImage(file);
    } else {
      item.textContent = String(await readAsText(file)).slice(0, 8000);
    }
  } catch {
    showError('Could not read that file.');
    return;
  }

  attachments.push(item);
  showError('');
  renderAttachments();
}

function buildTextWithFiles(baseText) {
  let text = baseText || '';
  attachments.forEach((a) => {
    if (a.type === 'file' && a.textContent) {
      text += `\n\n--- Attached file: ${a.name} ---\n${a.textContent}`;
    }
  });
  return text.slice(0, 24000);
}

function primaryImage() {
  return attachments.find((a) => a.type === 'image')?.dataUrl || '';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function refreshPageContext() {
  showError('');
  $('page-title').textContent = 'Loading page…';
  $('page-url').textContent = '';
  $('page-stats').textContent = '';

  const tab = await getActiveTab();
  if (!tab?.id) {
    renderPageMeta({ ok: false, message: 'No active tab found.' });
    return;
  }

  const res = await chrome.runtime.sendMessage({
    type: 'EXTRACT_ACTIVE_PAGE',
    tabId: tab.id
  }).catch(() => null);

  renderPageMeta(res || { ok: false, message: 'Failed to reach the page.' });
}

async function ensureAuth() {
  const res = await chrome.runtime.sendMessage({ type: 'GET_USER' }).catch(() => ({}));
  const signedIn = !!res?.user;
  $('auth-gate').classList.toggle('hidden', signedIn);
  $('main').classList.toggle('hidden', !signedIn);
  renderAccount(res?.user || null);
  closeAccountMenu();
  return signedIn;
}

function hideBootLoader() {
  const el = $('boot-loader');
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('is-leaving');
  window.setTimeout(() => {
    el.classList.add('hidden');
    el.setAttribute('aria-busy', 'false');
  }, 200);
}

async function init() {
  try {
    const signedIn = await ensureAuth();
    if (signedIn) {
      await Promise.all([refreshPageContext(), loadModels()]);
      await consumePending();
      if (!bootActionDone) await startPageAction('summarize');
    }
  } finally {
    hideBootLoader();
  }
}

async function runPageAction({ action, extra, label, clearPrompt = false }) {
  if (busy) return;
  showError('');

  const hasFiles = attachments.some((a) => a.type === 'file' && a.textContent);
  const hasImage = !!primaryImage();
  const pageText = pageContext?.text?.trim() || '';

  if (!pageText && !hasFiles && !hasImage) {
    showError('No page text available. Refresh or attach a file.');
    return;
  }

  setBusy(true);
  showResult('', label);

  try {
    // Free Page Assistant is limited (smaller page input); Pro gets full extract
    const stored = await chrome.storage.local.get('plan');
    const isPro = stored.plan === 'pro';
    const maxChars = isPro ? 48000 : 24000;
    const metaBits = [
      pageContext?.title ? `Page title: ${pageContext.title}` : '',
      pageContext?.url ? `Page URL: ${pageContext.url}` : ''
    ].filter(Boolean).join('\n');
    let textForAi = pageText
      ? (metaBits ? `${metaBits}\n\n${pageText}` : pageText)
      : '(No page text — use the attached file/image.)';
    if (pageText && textForAi.length > maxChars) {
      textForAi = textForAi.slice(0, maxChars);
    }

    const payload = {
      type: 'RUN_ACTION',
      action,
      text: buildTextWithFiles(textForAi),
      extra: extra || undefined,
      source: 'page'
    };
    if (selectedModel) payload.model = selectedModel;
    const image = primaryImage();
    if (image) payload.image = image;

    const res = await chrome.runtime.sendMessage(payload);

    if (res?.error === 'not_authenticated') {
      await ensureAuth();
      showError('Please sign in to continue.');
      return;
    }
    if (res?.error) {
      showError(res.message || res.error || 'Something went wrong.');
      return;
    }
    showResult(res?.result || '', label);
    if (clearPrompt) {
      clearAskInput();
      attachments = [];
      renderAttachments();
    }
    // Live usage refresh (no full page reload)
    if (res?.usage) {
      const latest = await chrome.runtime.sendMessage({ type: 'GET_USER' }).catch(() => ({}));
      renderAccount({ ...(latest?.user || {}), usage: res.usage });
    } else {
      await ensureAuth();
    }
  } catch {
    showError('Network error. Try again.');
  } finally {
    setBusy(false);
  }
}

async function runPresetKey(key) {
  const preset = PRESETS[key];
  if (!preset) return;
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
  document.querySelector(`[data-preset="${key}"]`)?.classList.add('is-active');
  await runPageAction(preset);
}

document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    runPresetKey(btn.getAttribute('data-preset'));
  });
});

$('ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const question = $('ask-input').value.trim();
  const hasAttach = attachments.length > 0;
  if (!question && !hasAttach) {
    showError('Type a question or attach a file.');
    return;
  }
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
  runPageAction({
    action: 'page_ask',
    extra: question || 'Describe the attached media and how it relates to this page.',
    label: 'Answer',
    clearPrompt: true
  });
});

$('ask-input').addEventListener('input', () => {
  const el = $('ask-input');
  el.style.height = 'auto';
  el.style.height = `${Math.min(72, el.scrollHeight)}px`;
});

$('attach-btn').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) await addFile(file);
});

let voiceSession = null;
let voiceListening = false;
let voiceTabId = null;

async function runVoiceWrite(transcript) {
  if (!transcript || busy) return;
  setBusy(true);
  showError('');
  showResult('', 'Voice draft');
  $('status').classList.remove('hidden');
  $('status').textContent = 'Polishing your draft…';

  try {
    const payload = {
      type: 'RUN_ACTION',
      action: 'voice_write',
      text: transcript,
      extra: 'Polished draft ready to copy or paste. Clear prose.',
      source: 'extension'
    };
    if (selectedModel) payload.model = selectedModel;
    const res = await chrome.runtime.sendMessage(payload);
    if (res?.error === 'not_authenticated') {
      await ensureAuth();
      showError('Please sign in to continue.');
      return;
    }
    if (res?.error) {
      showError(res.message || res.error || 'Something went wrong.');
      return;
    }
    const draft = (res?.result || '').trim();
    showResult(draft, 'Voice draft');
    if ($('ask-input')) {
      $('ask-input').value = draft;
      $('ask-input').dispatchEvent(new Event('input'));
    }
    showError('');
  } catch {
    showError('Network error. Try again.');
  } finally {
    setBusy(false);
  }
}

function setVoiceUi(on) {
  voiceListening = !!on;
  const btn = $('voice-btn');
  if (!btn) return;
  btn.classList.toggle('is-listening', voiceListening);
  btn.setAttribute('aria-pressed', voiceListening ? 'true' : 'false');
}

function clearVoiceUi() {
  setVoiceUi(false);
  voiceTabId = null;
  voiceSession = null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'VOICE_EVENT') return;
  if (msg.event === 'start') {
    setVoiceUi(true);
    showError('');
    $('status').classList.remove('hidden');
    $('status').textContent = 'Listening… speak, then tap mic again. (Allow mic on the website if asked.)';
    return;
  }
  if (msg.event === 'result' && msg.text) {
    if ($('ask-input')) {
      $('ask-input').value = msg.text;
      $('ask-input').dispatchEvent(new Event('input'));
    }
    return;
  }
  if (msg.event === 'error') {
    clearVoiceUi();
    $('status').classList.add('hidden');
    showError(msg.message || 'Could not capture voice. Try again.');
    return;
  }
  if (msg.event === 'end') {
    clearVoiceUi();
    const fromInput = ($('ask-input')?.value || '').trim();
    const transcript = (msg.text || fromInput || '').trim();
    if (transcript) {
      $('status').classList.add('hidden');
      runVoiceWrite(transcript);
    } else {
      $('status').classList.add('hidden');
      showError('No speech captured. Tap mic, allow microphone for this website when asked, speak, then tap mic again.');
    }
  }
});

$('voice-btn')?.addEventListener('click', async () => {
  const btn = $('voice-btn');
  if (voiceListening) {
    await chrome.runtime.sendMessage({ type: 'VOICE_STOP', tabId: voiceTabId }).catch(() => {});
    return;
  }
  if (busy) return;

  showError('');
  $('status').classList.remove('hidden');
    $('status').textContent = 'Starting microphone… if prompted on the page, click Allow.';
  btn?.classList.add('is-listening');

  const res = await chrome.runtime.sendMessage({ type: 'VOICE_START' }).catch(() => null);
  if (!res?.ok) {
    clearVoiceUi();
    $('status').classList.add('hidden');
    const msg = res?.message || 'Could not start microphone.';
    showError(msg);
    if (res?.error === 'restricted') {
      // Offer extension mic helper page as last resort
      chrome.runtime.sendMessage({ type: 'VOICE_OPEN_MIC_HELP' }).catch(() => {});
    }
    return;
  }
  voiceTabId = res.tabId || null;
  // Actual listening UI waits for VOICE_EVENT start from the page.
});

$('copy-btn').addEventListener('click', async () => {
  const text = ($('result').innerText || '').trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const btn = $('copy-btn');
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = prev; }, 1200);
  } catch {
    showError('Could not copy.');
  }
});

$('refresh-page').addEventListener('click', () => refreshPageContext());

$('sign-in-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_AUTH' });
});

$('menu-sign-in-btn')?.addEventListener('click', () => {
  closeAccountMenu();
  chrome.runtime.sendMessage({ type: 'OPEN_AUTH' });
});

$('menu-email-sign-in-btn')?.addEventListener('click', () => {
  closeAccountMenu();
  setGateMode('signin');
  $('auth-gate')?.classList.remove('hidden');
  $('main')?.classList.add('hidden');
});

$('gate-show-signup')?.addEventListener('click', () => setGateMode('signup'));
$('gate-show-signin')?.addEventListener('click', () => setGateMode('signin'));
$('gate-show-forgot')?.addEventListener('click', () => setGateMode('forgot'));
$('gate-forgot-back')?.addEventListener('click', () => setGateMode('signin'));

$('gate-signin')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setGateMsg('', '');
  const btn = $('gate-signin-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'PASSWORD_LOGIN',
      email: $('gate-email').value.trim(),
      password: $('gate-password').value
    });
    if (res?.error) {
      setGateMsg('error', res.message || 'Sign in failed.');
      return;
    }
    await ensureAuth();
    await Promise.all([refreshPageContext(), loadModels()]);
  } catch {
    setGateMsg('error', 'Network error. Please try again.');
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('gate-signup')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setGateMsg('', '');
  const btn = $('gate-signup-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'PASSWORD_SIGNUP',
      name: $('gate-signup-name').value.trim(),
      email: $('gate-signup-email').value.trim(),
      password: $('gate-signup-password').value
    });
    if (res?.error) {
      setGateMsg('error', res.message || 'Could not create account.');
      return;
    }
    await ensureAuth();
    await Promise.all([refreshPageContext(), loadModels()]);
  } catch {
    setGateMsg('error', 'Network error. Please try again.');
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('gate-forgot')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setGateMsg('', '');
  const btn = $('gate-forgot-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'PASSWORD_FORGOT',
      email: $('gate-forgot-email').value.trim()
    });
    if (res?.error) {
      setGateMsg('error', res.message || 'Could not start reset.');
      return;
    }
    let msg = res.message || 'If that email exists, reset instructions are ready.';
    if (res.resetUrl) msg += ` Dev: ${res.resetUrl}`;
    setGateMsg('ok', msg);
  } catch {
    setGateMsg('error', 'Network error. Please try again.');
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('open-app-btn').addEventListener('click', () => {
  closeAccountMenu();
  chrome.runtime.sendMessage({ type: 'OPEN_WEB_APP', path: '/app' });
});

$('account-settings-btn')?.addEventListener('click', () => {
  closeAccountMenu();
  chrome.runtime.sendMessage({ type: 'OPEN_WEB_APP', path: '/app/settings' });
});

$('account-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeModelMenu();
  toggleAccountMenu();
});

$('model-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeAccountMenu();
  const menu = $('model-menu');
  const btn = $('model-btn');
  const open = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
});

$('model-menu')?.addEventListener('click', (e) => e.stopPropagation());

$('account-menu').addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('click', () => {
  closeAccountMenu();
  closeModelMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAccountMenu();
    closeModelMenu();
  }
});

$('sign-out-btn').addEventListener('click', async () => {
  closeAccountMenu();
  await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
  await ensureAuth();
});

$('upgrade-btn').addEventListener('click', async () => {
  closeAccountMenu();
  const res = await chrome.runtime.sendMessage({ type: 'CHECKOUT' }).catch(() => ({}));
  if (res?.url) {
    chrome.tabs.create({ url: res.url });
  } else {
    showError(res?.message || 'Billing is not available right now.');
  }
});

$('manage-btn').addEventListener('click', async () => {
  closeAccountMenu();
  const res = await chrome.runtime.sendMessage({ type: 'PORTAL' }).catch(() => ({}));
  if (res?.url) {
    chrome.tabs.create({ url: res.url });
  } else {
    showError(res?.message || 'No billing account found.');
  }
});

$('help-btn').addEventListener('click', () => closeAccountMenu());

async function startPageAction(actionKey) {
  if (!actionKey || !PRESETS[actionKey]) return false;
  if (bootActionDone || busy) return false;
  bootActionDone = true;

  if (!pageContext?.text?.trim()) {
    await refreshPageContext();
  }
  if (!pageContext?.text?.trim()) {
    bootActionDone = false;
    return false;
  }

  await runPresetKey(actionKey);
  return true;
}

async function consumePending(key) {
  let actionKey = key || null;
  if (!actionKey) {
    const stored = await chrome.storage.session.get('writeaiPendingPageAction');
    actionKey = stored.writeaiPendingPageAction || null;
  }
  await chrome.storage.session.remove('writeaiPendingPageAction');
  if (!actionKey) return false;
  return startPageAction(actionKey);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'USAGE_UPDATED' && msg.usage) {
    chrome.runtime.sendMessage({ type: 'GET_USER' }).then((res) => {
      if (res?.user) renderAccount({ ...res.user, usage: msg.usage });
      else renderAccount({ usage: msg.usage });
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'RUN_PENDING_PAGE_ACTION' || !msg.pending) return;
  ensureAuth().then((ok) => {
    if (!ok) return;
    consumePending(msg.pending);
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.writeaiPendingPageAction?.newValue) {
    ensureAuth().then((ok) => {
      if (!ok) return;
      consumePending(changes.writeaiPendingPageAction.newValue);
    });
  }
  if (area !== 'local') return;
  if (changes.usage?.newValue) {
    chrome.runtime.sendMessage({ type: 'GET_USER' }).then((res) => {
      if (res?.user) renderAccount({ ...res.user, usage: changes.usage.newValue });
      else renderAccount({ usage: changes.usage.newValue });
    }).catch(() => {});
  }
  if (changes.token) {
    ensureAuth().then(async (ok) => {
      if (!ok) return;
      await refreshPageContext();
      await loadModels();
      if (!bootActionDone) await startPageAction('summarize');
    });
  }
});

chrome.tabs.onActivated.addListener(() => {
  if ($('main').classList.contains('hidden')) return;
  refreshPageContext();
});

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status !== 'complete' || !tab?.active) return;
  if ($('main').classList.contains('hidden')) return;
  refreshPageContext();
});

init();
