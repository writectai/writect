const API_BASE = window.WRITEAI_API_BASE || '';

function getToken() {
  return localStorage.getItem('writeai_token') || '';
}

function setToken(token) {
  if (token) localStorage.setItem('writeai_token', token);
  else localStorage.removeItem('writeai_token');
}

/** Ask the Chrome extension (if installed) for its session token. */
function syncFromExtension(timeoutMs = 700) {
  const existing = getToken();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (token) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      if (token) setToken(token);
      resolve(token || '');
    };

    function onMessage(event) {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;
      if (event.data.type !== 'WRITEAI_EXT_TOKEN') return;
      finish(event.data.token || '');
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'WRITEAI_REQUEST_TOKEN' }, '*');
    setTimeout(() => finish(getToken()), timeoutMs);
  });
}

function pushTokenToExtension(token) {
  if (!token) return;
  window.postMessage({ type: 'WRITEAI_WEB_AUTH', token }, '*');
}

function signOutExtension() {
  window.postMessage({ type: 'WRITEAI_WEB_SIGN_OUT' }, '*');
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, data };
}

/**
 * POST + SSE reader. Calls onDelta(text) for each token chunk.
 * Resolves with { ok, status, data } where data is the final done/error payload.
 */
async function apiStream(path, body, { onDelta } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || !contentType.includes('text/event-stream')) {
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    return { ok: false, status: res.status, data };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalData = { type: 'done', result: '' };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data:')) || '';
      if (!line) continue;
      let payload;
      try {
        payload = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (payload.type === 'delta' && payload.text) {
        if (typeof onDelta === 'function') onDelta(payload.text);
      } else if (payload.type === 'done' || payload.type === 'error') {
        finalData = payload;
      }
    }
  }

  if (finalData.type === 'error') {
    return { ok: false, status: 500, data: finalData };
  }
  return { ok: true, status: 200, data: finalData };
}

window.WriteAIApi = {
  getToken,
  setToken,
  syncFromExtension,
  pushTokenToExtension,
  signOutExtension,
  detectExtension,
  apiFetch,
  apiStream
};

/** True when the Chrome extension content bridge replies. */
function detectExtension(timeoutMs = 500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (present) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      resolve(!!present);
    };

    function onMessage(event) {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'WRITEAI_EXT_TOKEN') finish(true);
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'WRITEAI_REQUEST_TOKEN' }, '*');
    setTimeout(() => finish(false), timeoutMs);
  });
}
