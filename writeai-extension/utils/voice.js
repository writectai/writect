/**
 * Shared Web Speech dictation helper (side panel + content scripts).
 * Chrome: webkitSpeechRecognition. Side panel needs getUserMedia first
 * or sessions end immediately with empty transcripts.
 */
(function (root) {
  const SpeechRecognition = root.SpeechRecognition || root.webkitSpeechRecognition;

  function isSupported() {
    return typeof SpeechRecognition === 'function';
  }

  async function ensureMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('not-allowed');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    });
    return stream;
  }

  function stopStream(stream) {
    try {
      stream?.getTracks?.().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
  }

  /**
   * @param {object} opts
   * @param {(text: string, isFinal: boolean) => void} [opts.onResult]
   * @param {(err: string) => void} [opts.onError]
   * @param {() => void} [opts.onStart]
   * @param {(finalText: string) => void} [opts.onEnd]
   * @param {string} [opts.lang]
   */
  function createSession(opts = {}) {
    if (!isSupported()) {
      return {
        supported: false,
        listening: false,
        start() {
          opts.onError?.('unsupported');
        },
        stop() {},
        abort() {}
      };
    }

    let recognition = null;
    let micStream = null;
    let listening = false;
    let userStopped = false;
    let starting = false;
    let finalBuffer = '';
    let interimBuffer = '';
    let lastHeard = '';
    let restartTimer = null;

    function transcriptNow() {
      return `${finalBuffer} ${interimBuffer}`.replace(/\s+/g, ' ').trim();
    }

    function commitInterim() {
      if (interimBuffer) {
        finalBuffer = `${finalBuffer} ${interimBuffer}`.trim();
        interimBuffer = '';
      }
      const text = (finalBuffer || lastHeard || '').trim();
      if (text) lastHeard = text;
      return text;
    }

    function clearRestart() {
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
    }

    function finish(reason) {
      clearRestart();
      listening = false;
      starting = false;
      const text = commitInterim() || lastHeard || '';
      stopStream(micStream);
      micStream = null;
      try {
        recognition?.abort?.();
      } catch {
        /* ignore */
      }
      recognition = null;
      if (reason === 'error') return;
      opts.onEnd?.(text);
    }

    function bindRecognition(rec) {
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = opts.lang || 'en-US';

      rec.onstart = () => {
        starting = false;
        listening = true;
      };

      rec.onresult = (event) => {
        if (!listening && !userStopped) return;
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

      rec.onerror = (event) => {
        const code = event?.error || 'speech_error';
        if (code === 'aborted') return;
        // Silence / network blips: keep session alive until user stops.
        if (code === 'no-speech' || code === 'network') return;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          userStopped = true;
          opts.onError?.(code);
          finish('error');
          return;
        }
        // Other errors: if user is still in a session, try to recover on onend.
      };

      rec.onend = () => {
        // Chrome often ends recognition after a pause even with continuous=true.
        // Restart until the user explicitly stops (push-to-talk).
        if (!userStopped && listening) {
          clearRestart();
          restartTimer = setTimeout(() => {
            if (userStopped || !listening) return;
            try {
              recognition = new SpeechRecognition();
              bindRecognition(recognition);
              recognition.start();
            } catch {
              finish('ok');
            }
          }, 120);
          return;
        }
        finish('ok');
      };
    }

    return {
      supported: true,
      get listening() {
        return listening || starting;
      },
      async start() {
        if (listening || starting) return;
        userStopped = false;
        starting = true;
        finalBuffer = '';
        interimBuffer = '';
        lastHeard = '';
        clearRestart();

        try {
          // Required in extension side panel — without this, Chrome ends with empty results.
          micStream = await ensureMicrophone();
        } catch {
          starting = false;
          opts.onError?.('not-allowed');
          return;
        }

        try {
          recognition = new SpeechRecognition();
          bindRecognition(recognition);
          recognition.start();
          opts.onStart?.();
        } catch {
          starting = false;
          stopStream(micStream);
          micStream = null;
          opts.onError?.('start_failed');
        }
      },
      stop() {
        userStopped = true;
        clearRestart();
        commitInterim();
        try {
          recognition?.stop?.();
        } catch {
          finish('ok');
        }
        // If recognition never started, still finish.
        if (!recognition) finish('ok');
      },
      abort() {
        userStopped = true;
        clearRestart();
        listening = false;
        starting = false;
        stopStream(micStream);
        micStream = null;
        try {
          recognition?.abort?.();
        } catch {
          /* ignore */
        }
        recognition = null;
      }
    };
  }

  root.WriteAIVoice = { isSupported, createSession };
})(typeof globalThis !== 'undefined' ? globalThis : window);
