/**
 * Injected for sidebar Voice → Writing.
 * Runs in the page tab so Chrome can prompt for this website's microphone.
 * Side-panel clicks have no page user-gesture, so we may show an in-page Allow button.
 */
(function () {
  if (window.__writeaiVoiceBridgeInstalled) return;
  window.__writeaiVoiceBridgeInstalled = true;

  let session = null;
  let gateEl = null;

  function emit(event, payload = {}) {
    chrome.runtime.sendMessage({ type: 'VOICE_EVENT', event, ...payload }).catch(() => {});
  }

  function removeGate() {
    try {
      gateEl?.remove?.();
    } catch {
      /* ignore */
    }
    gateEl = null;
  }

  function showMicGate() {
    removeGate();
    const el = document.createElement('div');
    el.id = 'writeai-mic-gate';
    el.setAttribute('role', 'dialog');
    el.innerHTML = `
      <div style="
        position:fixed;z-index:2147483646;right:16px;bottom:16px;max-width:280px;
        background:#111114;color:#f4f4f5;border:1px solid #333;border-radius:14px;
        box-shadow:0 12px 40px rgba(0,0,0,.45);padding:14px 14px 12px;font:600 13px/1.35 system-ui,sans-serif;
      ">
        <div style="margin-bottom:10px;font-weight:700;">Writect needs the microphone</div>
        <div style="font-weight:500;color:#a1a1aa;margin-bottom:12px;">
          Click Allow, then approve the Chrome prompt for this site.
        </div>
        <button type="button" data-wa-mic-allow style="
          width:100%;border:0;border-radius:10px;padding:10px 12px;cursor:pointer;font-weight:700;
          background:linear-gradient(135deg,#f21862,#6b0fb3);color:#fff;
        ">Allow microphone</button>
        <button type="button" data-wa-mic-cancel style="
          width:100%;margin-top:8px;border:0;border-radius:10px;padding:8px 12px;cursor:pointer;
          background:transparent;color:#a1a1aa;font-weight:600;
        ">Cancel</button>
      </div>
    `;
    el.querySelector('[data-wa-mic-allow]')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeGate();
      beginSession();
    });
    el.querySelector('[data-wa-mic-cancel]')?.addEventListener('click', (e) => {
      e.preventDefault();
      removeGate();
      emit('error', {
        code: 'cancelled',
        message: 'Microphone cancelled. Tap the mic in the sidebar to try again.'
      });
    });
    (document.documentElement || document.body).appendChild(el);
    gateEl = el;
    emit('start'); // show listening UI while waiting for page click
    emit('result', { text: '' });
  }

  function beginSession() {
    if (!window.WriteAIVoice?.isSupported?.()) {
      emit('error', {
        code: 'unsupported',
        message: 'Voice dictation is not supported in this browser.'
      });
      return;
    }
    if (session?.listening) {
      session.stop();
      return;
    }

    session = window.WriteAIVoice.createSession({
      onStart() {
        emit('start');
      },
      onResult(text) {
        if (text) emit('result', { text });
      },
      onError(code) {
        session = null;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          showMicGate();
          return;
        }
        emit('error', {
          code,
          message: 'Could not capture voice. Try again.'
        });
      },
      onEnd(finalText) {
        session = null;
        emit('end', { text: finalText || '' });
      }
    });
    session.start();
  }

  async function startVoice() {
    removeGate();
    // Probe mic with a short getUserMedia in this call stack when possible.
    // If blocked (common when started from sidebar message), show in-page Allow button.
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((t) => t.stop());
      }
      beginSession();
    } catch {
      showMicGate();
    }
  }

  function stopVoice() {
    removeGate();
    session?.stop?.();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'VOICE_START') {
      startVoice();
      sendResponse({ ok: true });
      return true;
    }
    if (msg?.type === 'VOICE_STOP') {
      stopVoice();
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  });
})();
