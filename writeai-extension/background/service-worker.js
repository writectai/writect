const API_BASE = 'https://writeai.wr-demo.com';
const WEB_APP = `${API_BASE}/app`;

const CONTEXT_ACTIONS = [
  { id: 'fix_grammar', title: 'Fix grammar & spelling' },
  { id: 'rephrase', title: 'Rephrase (meaning-safe)' },
  { id: 'translate', title: 'Translate…' },
  { id: 'summarize', title: 'Summarize' },
  { id: 'explain', title: 'Explain' }
];

const PAGE_MENU_ACTIONS = [
  { id: 'writeai_page_open', title: 'Open sidebar', pending: null },
  { id: 'writeai_page_summarize', title: 'Summarize the page', pending: 'summarize' },
  { id: 'writeai_page_keypoints', title: 'Key points', pending: 'keypoints' },
  { id: 'writeai_page_simplify', title: 'Simplify this page', pending: 'simplify' }
];

function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    // Selection submenu (unchanged behavior for highlighted text)
    chrome.contextMenus.create({
      id: 'writeai_root',
      title: 'Writect',
      contexts: ['selection']
    });
    CONTEXT_ACTIONS.forEach((action) => {
      chrome.contextMenus.create({
        id: `writeai_${action.id}`,
        parentId: 'writeai_root',
        title: action.title,
        contexts: ['selection']
      });
    });

    // Page submenu (Sider-style dropdown when right-clicking the page)
    chrome.contextMenus.create({
      id: 'writeai_page_root',
      title: 'Writect',
      contexts: ['page']
    });
    PAGE_MENU_ACTIONS.forEach((item) => {
      chrome.contextMenus.create({
        id: item.id,
        parentId: 'writeai_page_root',
        title: item.title,
        contexts: ['page']
      });
    });
  });
}

function setupUninstallUrl() {
  chrome.runtime.setUninstallURL(`${API_BASE}/uninstall`);
}

function setupSidePanel() {
  // Toolbar icon opens the side panel (like Sider) — no popup.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.sidePanel.setOptions({ path: 'sidepanel/sidepanel.html', enabled: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  buildContextMenus();
  setupUninstallUrl();
  setupSidePanel();
});
chrome.runtime.onStartup.addListener(() => {
  buildContextMenus();
  setupUninstallUrl();
  setupSidePanel();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id || !String(info.menuItemId).startsWith('writeai_')) return;

  const pageItem = PAGE_MENU_ACTIONS.find((a) => a.id === info.menuItemId);
  if (pageItem) {
    // CRITICAL: do not await before sidePanel.open — Chrome requires a user gesture.
    openSidePanelFromGesture(tab, pageItem.pending);
    return;
  }

  const action = String(info.menuItemId).replace('writeai_', '');
  if (!CONTEXT_ACTIONS.some((a) => a.id === action)) return;

  const payload = {
    type: 'CONTEXT_ACTION',
    action,
    text: (info.selectionText || '').trim()
  };

  chrome.tabs.sendMessage(tab.id, payload).catch(() => {
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content/content.js'] },
      () => chrome.tabs.sendMessage(tab.id, payload).catch(() => {})
    );
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RUN_ACTION') {
    handleAction(message).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_MODELS') {
    getModels().then(sendResponse);
    return true;
  }
  if (message.type === 'OPEN_AUTH') {
    openAuthTab();
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'OPEN_LOGIN_PAGE') {
    chrome.tabs.create({ url: `${API_BASE}/login` });
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'PASSWORD_LOGIN') {
    passwordLogin(message).then(sendResponse);
    return true;
  }
  if (message.type === 'PASSWORD_SIGNUP') {
    passwordSignup(message).then(sendResponse);
    return true;
  }
  if (message.type === 'PASSWORD_FORGOT') {
    passwordForgot(message).then(sendResponse);
    return true;
  }
  if (message.type === 'SET_PASSWORD') {
    setPassword(message).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_USER') {
    getUser().then(sendResponse);
    return true;
  }
  if (message.type === 'CHECKOUT') {
    createCheckout().then(sendResponse);
    return true;
  }
  if (message.type === 'PORTAL') {
    openPortal().then(sendResponse);
    return true;
  }
  if (message.type === 'GET_ANNOUNCEMENT') {
    getAnnouncement().then(sendResponse);
    return true;
  }
  if (message.type === 'SIGN_OUT') {
    chrome.storage.local.remove(['token', 'plan']).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'WRITEAI_GET_TOKEN') {
    getToken().then((token) => sendResponse({ token: token || null }));
    return true;
  }
  if (message.type === 'WRITEAI_AUTH' && message.token) {
    chrome.storage.local.set({ token: message.token }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'OPEN_SIDE_PANEL') {
    // May fail if not a user gesture — callers should prefer context menu / toolbar.
    openSidePanelFromGesture(
      { id: message.tabId, windowId: message.windowId },
      message.pendingAction
    );
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'EXTRACT_ACTIVE_PAGE') {
    extractActivePage(message.tabId).then(sendResponse);
    return true;
  }
  if (message.type === 'VOICE_START') {
    startTabVoice(message.tabId).then(sendResponse);
    return true;
  }
  if (message.type === 'VOICE_STOP') {
    stopTabVoice(message.tabId).then(sendResponse);
    return true;
  }
  if (message.type === 'VOICE_EVENT') {
    // Content scripts broadcast to all extension pages (sidepanel listens directly).
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'VOICE_OPEN_MIC_HELP') {
    chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/mic-permission.html') });
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === 'OPEN_WEB_APP') {
    const path = typeof message.path === 'string' ? message.path : '/app';
    const safePath = path.startsWith('/') ? path : `/${path}`;
    chrome.tabs.create({ url: `${API_BASE}${safePath}` });
    sendResponse({ ok: true });
    return true;
  }
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === 'WRITEAI_AUTH' && message.token) {
    chrome.storage.local.set({ token: message.token }).then(() => {
      sendResponse?.({ ok: true });
    });
    return true;
  }
  if (message.type === 'WRITEAI_GET_TOKEN') {
    getToken().then((token) => sendResponse({ token: token || null }));
    return true;
  }
});

async function getToken() {
  const { token } = await chrome.storage.local.get('token');
  return token;
}

async function apiFetch(path, options = {}) {
  const token = await getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function handleAction({ action, text, extra, model, length, forceRefresh, image, source }) {
  const token = await getToken();

  if (!token) {
    openAuthTab();
    return { error: 'not_authenticated' };
  }

  try {
    const body = {
      action,
      text,
      extra,
      forceRefresh: !!forceRefresh,
      source: source || 'extension'
    };
    if (model) body.model = model;
    if (length) body.length = length;
    if (image) body.image = image;

    const { ok, data } = await apiFetch('/action', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    if (!ok) return { error: data.error, message: data.message };
    if (data.usage) {
      chrome.storage.local.set({
        usage: data.usage,
        plan: data.usage.plan || (await chrome.storage.local.get('plan')).plan
      }).catch(() => {});
      chrome.runtime.sendMessage({ type: 'USAGE_UPDATED', usage: data.usage }).catch(() => {});
    } else {
      // Fallback: refresh /user/me so sidepanel/popup stay in sync without reload
      getUser().then((res) => {
        if (res?.user?.usage) {
          chrome.runtime.sendMessage({ type: 'USAGE_UPDATED', usage: res.user.usage, user: res.user }).catch(() => {});
        }
      }).catch(() => {});
    }
    return {
      result: data.result,
      cached: data.cached,
      meaning: data.meaning || null,
      usage: data.usage || null,
      action_cost: data.action_cost
    };
  } catch (err) {
    return { error: 'network_error' };
  }
}

async function getModels() {
  const token = await getToken();
  if (!token) return { error: 'not_authenticated', models: [] };

  try {
    const { ok, data } = await apiFetch('/user/models');
    if (!ok) return { error: data.error || 'fetch_failed', models: [] };
    return {
      models: data.models || [],
      plan: data.plan,
      primary: data.primary
    };
  } catch {
    return { error: 'network_error', models: [] };
  }
}

async function getAnnouncement() {
  try {
    const { ok, data } = await apiFetch('/user/announcement');
    if (!ok || !data.announcement) return { announcement: null };
    return { announcement: data.announcement };
  } catch {
    return { announcement: null };
  }
}

async function getUser() {
  const token = await getToken();
  if (!token) return { error: 'not_authenticated' };

  const { ok, data } = await apiFetch('/user/me');
  if (!ok) return { error: data.error || 'fetch_failed' };
  // Cache plan for UI (sidepanel Free page-input limits, badges, etc.)
  if (data?.plan) {
    chrome.storage.local.set({ plan: data.plan }).catch(() => {});
  }
  return { user: data };
}

async function createCheckout() {
  const { ok, data } = await apiFetch('/billing/checkout', { method: 'POST' });
  if (!ok) return { error: data.error || 'checkout_failed', message: data.message };
  return { url: data.url };
}

async function openPortal() {
  const { ok, data } = await apiFetch('/billing/portal', { method: 'POST' });
  if (!ok) return { error: data.error || 'portal_failed', message: data.message };
  return { url: data.url };
}

function openAuthTab() {
  chrome.tabs.create({ url: `${API_BASE}/auth/google?extensionId=${chrome.runtime.id}` });
}

async function passwordLogin({ email, password }) {
  try {
    const { ok, data } = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (!ok) return { error: data.error || 'login_failed', message: data.message };
    if (data.token) {
      await chrome.storage.local.set({ token: data.token, plan: data.user?.plan || 'free' });
    }
    return { ok: true, user: data.user };
  } catch {
    return { error: 'network_error', message: 'Network error. Please try again.' };
  }
}

async function passwordSignup({ email, password, name }) {
  try {
    const { ok, data } = await apiFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name })
    });
    if (!ok) return { error: data.error || 'signup_failed', message: data.message };
    if (data.token) {
      await chrome.storage.local.set({ token: data.token, plan: data.user?.plan || 'free' });
    }
    return { ok: true, user: data.user };
  } catch {
    return { error: 'network_error', message: 'Network error. Please try again.' };
  }
}

async function passwordForgot({ email }) {
  try {
    const { ok, data } = await apiFetch('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    if (!ok) return { error: data.error || 'forgot_failed', message: data.message };
    return { ok: true, message: data.message, resetUrl: data.resetUrl };
  } catch {
    return { error: 'network_error', message: 'Network error. Please try again.' };
  }
}

async function setPassword({ currentPassword, newPassword }) {
  try {
    const body = { newPassword };
    if (currentPassword) body.currentPassword = currentPassword;
    const { ok, data } = await apiFetch('/auth/password', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    if (!ok) return { error: data.error || 'password_failed', message: data.message };
    return {
      ok: true,
      message: data.message,
      created: data.created,
      has_password: data.has_password,
      has_google: data.has_google,
      auth_provider: data.auth_provider,
      sign_in_method: data.sign_in_method
    };
  } catch {
    return { error: 'network_error', message: 'Network error. Please try again.' };
  }
}

function isRestrictedUrl(url = '') {
  return /^(chrome|chrome-extension|edge|about|devtools|view-source|chrome-search):/i.test(url)
    || /^https?:\/\/chrome\.google\.com\/webstore/i.test(url)
    || /^https?:\/\/chromewebstore\.google\.com/i.test(url);
}

/**
 * Must stay synchronous relative to the click/gesture.
 * Never await before chrome.sidePanel.open().
 */
function openSidePanelFromGesture(tab, pendingAction) {
  if (pendingAction) {
    chrome.storage.session.set({ writeaiPendingPageAction: pendingAction });
  }

  const tabId = tab?.id;
  const windowId = tab?.windowId;

  chrome.sidePanel.setOptions({
    path: 'sidepanel/sidepanel.html',
    enabled: true
  });

  const openOpts = windowId != null ? { windowId } : { tabId };
  chrome.sidePanel.open(openOpts).then(() => {
    if (pendingAction) {
      chrome.runtime.sendMessage({
        type: 'RUN_PENDING_PAGE_ACTION',
        pending: pendingAction
      }).catch(() => {});
    }
  }).catch((err) => {
    console.error('Writect side panel open failed:', err);
  });
}

async function extractActivePage(tabId) {
  try {
    const tab = tabId
      ? await chrome.tabs.get(tabId)
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

    if (!tab?.id) return { ok: false, error: 'no_tab', message: 'No active tab.' };
    if (isRestrictedUrl(tab.url || '')) {
      return {
        ok: false,
        error: 'restricted',
        url: tab.url,
        message: 'Chrome system pages can’t be read. Open a normal website.'
      };
    }

    const tryExtract = () =>
      chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PAGE' });

    try {
      const data = await tryExtract();
      if (data?.ok) return data;
      if (data && data.ok === false) return data;
    } catch {
      /* inject below */
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/page-extract.js']
    });

    const data = await tryExtract();
    if (data?.ok) return data;
    return data || { ok: false, error: 'extract_failed', message: 'Could not read page text.' };
  } catch (err) {
    return {
      ok: false,
      error: 'extract_failed',
      message: err?.message || 'Could not read page text.'
    };
  }
}

async function resolveVoiceTab(tabId) {
  if (tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

async function ensureVoiceScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['utils/voice.js', 'content/voice-bridge.js']
  });
}

async function startTabVoice(tabId) {
  try {
    const tab = await resolveVoiceTab(tabId);
    if (!tab?.id) {
      return { ok: false, error: 'no_tab', message: 'No active tab found.' };
    }
    if (isRestrictedUrl(tab.url || '')) {
      return {
        ok: false,
        error: 'restricted',
        message: 'Open a normal website tab (not chrome://) to use the mic.'
      };
    }

    await ensureVoiceScripts(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: 'VOICE_START' });
    return { ok: true, tabId: tab.id };
  } catch (err) {
    return {
      ok: false,
      error: 'voice_failed',
      message: err?.message || 'Could not start microphone on this page. Refresh the tab and try again.'
    };
  }
}

async function stopTabVoice(tabId) {
  try {
    const tab = await resolveVoiceTab(tabId);
    if (!tab?.id) return { ok: true };
    await chrome.tabs.sendMessage(tab.id, { type: 'VOICE_STOP' }).catch(() => {});
    return { ok: true };
  } catch {
    return { ok: true };
  }
}
