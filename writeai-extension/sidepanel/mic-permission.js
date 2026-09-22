(async function () {
  const msg = document.getElementById('msg');
  const btn = document.getElementById('btn');

  async function requestMic() {
    btn.disabled = true;
    msg.textContent = 'Waiting for permission…';
    msg.className = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach((t) => t.stop());
      msg.textContent = 'Microphone enabled. You can close this tab and tap the mic in the sidebar.';
      msg.className = 'ok';
      btn.textContent = 'Done — close tab';
      btn.disabled = false;
      btn.onclick = () => window.close();
      chrome.runtime.sendMessage({ type: 'VOICE_MIC_GRANTED' }).catch(() => {});
      setTimeout(() => window.close(), 1200);
    } catch {
      msg.textContent = 'Permission denied. In Chrome Settings → Privacy → Microphone, allow this extension, then try again.';
      msg.className = 'err';
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
  }

  btn.addEventListener('click', requestMic);
  // Auto-prompt on open (still a user gesture from opening the tab via click chain).
  requestMic();
})();
