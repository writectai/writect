/**
 * Syncs JWT between chrome.storage (extension) and localStorage (web app)
 * on WriteAI origin pages so /login and /app share one session.
 */
(function () {
  function isAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function postToken(token) {
    window.postMessage({ type: 'WRITEAI_EXT_TOKEN', token: token || null }, '*');
  }

  function writePageToken(token) {
    try {
      if (token) localStorage.setItem('writeai_token', token);
    } catch {
      /* ignore quota / private mode */
    }
  }

  function getExtToken() {
    return new Promise((resolve) => {
      if (!isAlive()) return resolve('');
      try {
        chrome.runtime.sendMessage({ type: 'WRITEAI_GET_TOKEN' }, (res) => {
          if (chrome.runtime.lastError) return resolve('');
          resolve(res?.token || '');
        });
      } catch {
        resolve('');
      }
    });
  }

  async function pushExtTokenToPage() {
    const token = await getExtToken();
    if (token) writePageToken(token);
    postToken(token);
    return token;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || typeof event.data !== 'object') return;
    if (!isAlive()) return;

    if (event.data.type === 'WRITEAI_REQUEST_TOKEN') {
      pushExtTokenToPage();
      return;
    }

    if (event.data.type === 'WRITEAI_WEB_AUTH' && event.data.token) {
      try {
        chrome.runtime.sendMessage(
          { type: 'WRITEAI_AUTH', token: event.data.token },
          () => void chrome.runtime.lastError
        );
      } catch {
        /* context invalidated */
      }
      return;
    }

    if (event.data.type === 'WRITEAI_WEB_SIGN_OUT') {
      try {
        chrome.runtime.sendMessage({ type: 'SIGN_OUT' }, () => void chrome.runtime.lastError);
      } catch {
        /* context invalidated */
      }
    }
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (!isAlive()) return;
      if (area !== 'local' || !changes.token) return;
      const next = changes.token.newValue || '';
      try {
        if (next) localStorage.setItem('writeai_token', next);
        else localStorage.removeItem('writeai_token');
      } catch {
        /* ignore */
      }
      postToken(next);
    });
  } catch {
    /* ignore */
  }

  pushExtTokenToPage();
})();
