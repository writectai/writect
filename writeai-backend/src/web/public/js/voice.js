/**
 * Web Speech dictation for the Writect web app.
 */
(function (root) {
  const SpeechRecognition = root.SpeechRecognition || root.webkitSpeechRecognition;

  function isSupported() {
    return typeof SpeechRecognition === 'function';
  }

  function createSession(opts = {}) {
    if (!isSupported()) {
      return {
        supported: false,
        listening: false,
        start() { opts.onError?.('unsupported'); },
        stop() {},
        abort() {}
      };
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = opts.lang || 'en-US';
    let listening = false;
    let ending = false;
    let finalBuffer = '';
    let interimBuffer = '';
    let lastHeard = '';

    function transcriptNow() {
      return `${finalBuffer} ${interimBuffer}`.replace(/\s+/g, ' ').trim();
    }

    function commitInterim() {
      if (interimBuffer) {
        finalBuffer = `${finalBuffer} ${interimBuffer}`.trim();
        interimBuffer = '';
      }
      const text = finalBuffer.trim() || lastHeard;
      if (text) lastHeard = text;
      return text;
    }

    recognition.onstart = () => {
      listening = true;
      ending = false;
      opts.onStart?.();
    };

    recognition.onresult = (event) => {
      if (!listening && !ending) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) {
          finalBuffer = `${finalBuffer} ${piece}`.trim();
          interimBuffer = '';
          lastHeard = finalBuffer;
          opts.onResult?.(finalBuffer, true);
        } else {
          interim += piece;
        }
      }
      if (interim) {
        interimBuffer = interim.trim();
        const live = transcriptNow();
        if (live) lastHeard = live;
        opts.onResult?.(live, false);
      }
    };

    recognition.onerror = (event) => {
      const code = event?.error || 'speech_error';
      if (code === 'aborted') return;
      if (code === 'no-speech') return;
      if (!listening && !ending) return;
      opts.onError?.(code);
    };

    recognition.onend = () => {
      const text = commitInterim() || lastHeard || '';
      const shouldEmit = listening || ending;
      listening = false;
      ending = false;
      interimBuffer = '';
      if (!shouldEmit) return;
      opts.onEnd?.(text);
    };

    return {
      supported: true,
      get listening() { return listening; },
      start() {
        finalBuffer = '';
        interimBuffer = '';
        lastHeard = '';
        ending = false;
        listening = false;
        try { recognition.start(); } catch { opts.onError?.('start_failed'); }
      },
      stop() {
        ending = true;
        commitInterim();
        try { recognition.stop(); } catch { /* ignore */ }
      },
      abort() {
        listening = false;
        ending = false;
        try { recognition.abort(); } catch { /* ignore */ }
      }
    };
  }

  root.WriteAIVoice = { isSupported, createSession };
})(window);
