(function () {
  const THEME_KEY = 'writeai_web_theme';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document.getElementById('theme-icon-dark')?.classList.toggle('hidden', theme === 'light');
    document.getElementById('theme-icon-light')?.classList.toggle('hidden', theme !== 'light');
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
  }

  function installExtension() {
    showToast('Open chrome://extensions → Enable Developer mode → Load unpacked → select the Writect-extension folder.');
  }

  function initHeroTyping() {
    const scene = document.getElementById('hero-compose');
    const el = document.getElementById('hero-result');
    const statusEl = document.getElementById('hero-status');
    const footEl = document.getElementById('hero-toolbar-foot');
    const pageText = document.getElementById('hero-page-text');
    const panel = document.getElementById('hero-compose-panel');
    const chip = document.getElementById('hero-ai-chip');
    const promptEl = document.getElementById('hero-compose-prompt');
    const genBtn = document.getElementById('hero-compose-generate');
    const toEl = document.getElementById('hero-mail-to');
    const subjectEl = document.getElementById('hero-mail-subject');
    const titleEl = document.getElementById('hero-compose-title');
    const aiLabel = document.getElementById('hero-ai-label');
    const panelMeta = document.getElementById('hero-panel-meta');
    if (!scene || !el || !pageText) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const demos = [
      {
        mode: 'select',
        app: 'gmail',
        title: 'New Message',
        chip: 'AI Compose',
        panelMeta: 'New draft',
        to: 'alex@company.com',
        subject: 'Deck for Friday',
        before: 'Please send the file tommorow so we can review it.',
        tool: 'Fix',
        status: 'Fixing grammar…',
        result: 'Please send the file tomorrow so we can review it.',
        after: 'Please send the file tomorrow so we can review it.',
        body: (mid) => `Hi Alex,<br><br>${mid}<br><br>Thanks,<br>Sam`
      },
      {
        mode: 'compose',
        app: 'gmail',
        title: 'New Message',
        chip: 'AI Compose',
        panelMeta: 'New draft',
        to: 'team@company.com',
        subject: 'Tomorrow’s plan',
        prompt: 'Ask the team for the deck by Friday before the client call',
        draft: 'Hi team,<br><br>Could you please share the deck by Friday ahead of the client call? Happy to adjust if timing is tight.<br><br>Thanks,<br>Sam'
      },
      {
        mode: 'select',
        app: 'whatsapp',
        title: 'Maya',
        chip: 'AI Compose',
        panelMeta: 'Reply draft',
        to: '',
        subject: '',
        before: 'can we move the call to 4?',
        tool: 'Rephrase',
        status: 'Rephrasing…',
        result: 'Would it work if we moved the call to 4:00?',
        after: 'Would it work if we moved the call to 4:00?',
        body: (mid) => `<div class="wa-bubble">${mid}</div>`
      },
      {
        mode: 'compose',
        app: 'whatsapp',
        title: 'Maya',
        chip: 'AI Compose',
        panelMeta: 'Reply draft',
        to: '',
        subject: '',
        prompt: 'Ask Maya if 4pm works for a quick sync',
        draft: '<div class="wa-bubble out">Would 4:00 work for a quick sync? Happy to adjust if you need later.</div>'
      },
      {
        mode: 'select',
        app: 'linkedin',
        title: 'Add a comment',
        chip: 'AI Compose',
        panelMeta: 'Comment draft',
        to: 'Hiring Manager',
        subject: '',
        before: 'saw your post about hiring — interested in learning more',
        tool: 'Rephrase',
        status: 'Rephrasing…',
        result: 'I saw your post about the open role and would welcome a short conversation.',
        after: 'I saw your post about the open role and would welcome a short conversation.',
        body: (mid) => mid
      },
      {
        mode: 'compose',
        app: 'linkedin',
        title: 'Create a post',
        chip: 'AI Compose',
        panelMeta: 'New draft',
        to: 'Your network',
        subject: '',
        prompt: 'Announce our product launch next Friday in a professional tone',
        draft: 'Excited to share that we’re launching next Friday. Looking forward to connecting with everyone who’s been following along.'
      }
    ];
    let idx = 0;
    let timers = [];

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }

    function later(fn, ms) {
      const id = setTimeout(fn, ms);
      timers.push(id);
      return id;
    }

    function setPhase(name) {
      scene.classList.remove(
        'is-ready', 'is-selecting', 'is-popup', 'is-choosing',
        'is-processing', 'is-writing', 'is-replace',
        'is-chip-click', 'is-panel', 'is-generating', 'is-inserted'
      );
      if (name) scene.classList.add(name);
    }

    function setApp(app) {
      scene.classList.remove('is-app-gmail', 'is-app-whatsapp', 'is-app-linkedin');
      scene.classList.add('is-app-' + app);
      document.querySelectorAll('.hero-app-tab').forEach((tab) => {
        const on = tab.dataset.appTab === app;
        tab.classList.toggle('on', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }

    function jumpToApp(app) {
      const next = demos.findIndex((d) => d.app === app);
      if (next < 0) return;
      idx = next;
      runDemo();
    }

    function setActiveTool(tool) {
      scene.querySelectorAll('.demo-tool').forEach((btn) => {
        btn.classList.toggle('on', !!tool && btn.dataset.tool === tool);
      });
    }

    function setStatus(text) {
      if (!statusEl) return;
      if (!text) {
        statusEl.hidden = true;
        statusEl.textContent = '';
        return;
      }
      statusEl.hidden = false;
      statusEl.innerHTML = `<span class="demo-spin" aria-hidden="true"></span>${text}`;
    }

    function setFoot(show) {
      if (!footEl) return;
      footEl.hidden = !show;
      footEl.querySelectorAll('.demo-foot-btn').forEach((b) => b.classList.remove('on'));
    }

    function setPanel(show) {
      if (!panel) return;
      panel.hidden = !show;
    }

    function hlMarkup(text) {
      return `<span class="hl" id="hero-hl"><span class="hl-fill"></span><span class="hl-label" id="hero-hl-label">${text}</span><svg class="hero-pointer" id="hero-pointer" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" stroke="#0f172a" stroke-width="1.35" stroke-linejoin="round" d="M5.2 2.8v14.6l3.5-3.3 2.3 5.5 2.3-1-2.4-5.5 4.9-.3z"/></svg></span>`;
    }

    function applyShell(demo) {
      setApp(demo.app);
      if (titleEl) titleEl.textContent = demo.title;
      if (aiLabel) aiLabel.textContent = demo.chip;
      if (panelMeta) panelMeta.textContent = demo.panelMeta;
      if (toEl) toEl.textContent = demo.to || '';
      if (subjectEl) subjectEl.textContent = demo.subject || '';
    }

    function typeResult(text, done) {
      el.innerHTML = '';
      const span = document.createElement('span');
      span.className = 'typing';
      el.appendChild(span);
      const caret = document.createElement('span');
      caret.className = 'hero-caret';
      caret.setAttribute('aria-hidden', 'true');
      el.appendChild(caret);

      if (reduce) {
        span.textContent = text;
        done();
        return;
      }

      let i = 0;
      const tick = setInterval(() => {
        i += 1;
        span.textContent = text.slice(0, i);
        if (i >= text.length) {
          clearInterval(tick);
          done();
        }
      }, 16);
      timers.push(tick);
    }

    function typePrompt(text, done) {
      if (!promptEl) {
        done();
        return;
      }
      promptEl.classList.add('has-text');
      if (reduce) {
        promptEl.textContent = text;
        done();
        return;
      }
      promptEl.textContent = '';
      let i = 0;
      const tick = setInterval(() => {
        i += 1;
        promptEl.textContent = text.slice(0, i);
        if (i >= text.length) {
          clearInterval(tick);
          done();
        }
      }, 28);
      timers.push(tick);
    }

    function runSelectDemo(demo) {
      applyShell(demo);
      pageText.innerHTML = demo.body(hlMarkup(demo.before));
      setActiveTool(null);
      setStatus('');
      setFoot(false);
      setPanel(false);
      el.innerHTML = '';
      setPhase('is-ready');

      if (reduce) {
        setActiveTool(demo.tool);
        setPhase('is-writing');
        typeResult(demo.result, () => later(nextDemo, 1800));
        return;
      }

      later(() => setPhase('is-selecting'), 500);
      later(() => {
        setPhase('is-popup');
        setActiveTool(null);
      }, 1800);
      later(() => {
        setPhase('is-choosing');
        setActiveTool(demo.tool);
      }, 2500);
      later(() => {
        setPhase('is-processing');
        setStatus(demo.status);
        el.innerHTML = '';
      }, 3200);
      later(() => {
        setStatus('');
        setPhase('is-writing');
        typeResult(demo.result, () => {
          setFoot(true);
          later(() => {
            setPhase('is-replace');
            footEl?.querySelector('[data-foot="Replace"]')?.classList.add('on');
            const label = document.getElementById('hero-hl-label');
            if (label) label.textContent = demo.after;
          }, 550);
          later(nextDemo, 2600);
        });
      }, 4500);
    }

    function runComposeDemo(demo) {
      applyShell(demo);
      pageText.innerHTML = demo.app === 'whatsapp'
        ? '<span class="gm-placeholder">Message…</span>'
        : '<span class="gm-placeholder">Write something, or use AI Compose…</span>';
      setActiveTool(null);
      setStatus('');
      setFoot(false);
      setPanel(false);
      el.innerHTML = '';
      if (promptEl) {
        promptEl.classList.remove('has-text');
        promptEl.textContent = 'What should the draft say? (optional)';
      }
      if (genBtn) genBtn.classList.remove('on');
      if (chip) chip.classList.remove('on');
      setPhase('is-ready');

      if (reduce) {
        setPanel(true);
        pageText.innerHTML = demo.draft;
        later(nextDemo, 2200);
        return;
      }

      later(() => {
        setPhase('is-chip-click');
        chip?.classList.add('on');
      }, 600);

      later(() => {
        chip?.classList.remove('on');
        setPanel(true);
        setPhase('is-panel');
      }, 1300);

      later(() => {
        typePrompt(demo.prompt, () => {
          later(() => {
            genBtn?.classList.add('on');
            setPhase('is-generating');
          }, 300);

          later(() => {
            setPanel(false);
            genBtn?.classList.remove('on');
            pageText.innerHTML = demo.draft;
            setPhase('is-inserted');
            later(nextDemo, 2600);
          }, 1700);
        });
      }, 1700);
    }

    function nextDemo() {
      idx = (idx + 1) % demos.length;
      runDemo();
    }

    function runDemo() {
      clearTimers();
      const demo = demos[idx];
      if (demo.mode === 'compose') runComposeDemo(demo);
      else runSelectDemo(demo);
    }

    document.querySelectorAll('.hero-app-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const app = tab.dataset.appTab;
        if (!app) return;
        jumpToApp(app);
      });
    });

    runDemo();
  }

  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach((el) => obs.observe(el));
  }

  function initMobileNav() {
    const toggle = document.getElementById('nav-mobile-toggle');
    const drawer = document.getElementById('mobile-nav');
    const close = document.getElementById('mobile-nav-close');

    toggle?.addEventListener('click', () => drawer?.classList.add('open'));
    close?.addEventListener('click', () => drawer?.classList.remove('open'));
    drawer?.addEventListener('click', (e) => {
      if (e.target === drawer) drawer.classList.remove('open');
    });
    drawer?.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => drawer.classList.remove('open'));
    });
  }

  function initPins() {
    const sections = Array.from(document.querySelectorAll('[data-pin]'));
    if (!sections.length) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let pins = [];
    let ticking = false;

    function update() {
      ticking = false;
      pins.forEach((p) => {
        if (p.section.classList.contains('is-filled') || !p.distance) {
          p.track.style.transform = '';
          if (p.fill) p.fill.style.width = '0%';
          updateNavState(p);
          return;
        }
        const rect = p.section.getBoundingClientRect();
        const scrolled = Math.min(Math.max(-rect.top, 0), p.distance);
        p.track.style.transform = 'translate3d(' + (-scrolled) + 'px,0,0)';
        if (p.fill) {
          p.fill.style.width = (p.distance ? (scrolled / p.distance) * 100 : 0) + '%';
        }
        updateNavState(p);
      });
    }

    function updateNavState(p) {
      if (!p.prev || !p.next) return;
      let atStart = true;
      let atEnd = true;
      if (p.section.classList.contains('is-pinned') && p.distance > 0) {
        const rect = p.section.getBoundingClientRect();
        const scrolled = Math.min(Math.max(-rect.top, 0), p.distance);
        atStart = scrolled <= 2;
        atEnd = scrolled >= p.distance - 2;
      } else if (p.viewport) {
        atStart = p.viewport.scrollLeft <= 2;
        atEnd = p.viewport.scrollLeft + p.viewport.clientWidth >= p.viewport.scrollWidth - 2;
      }
      p.prev.disabled = atStart;
      p.next.disabled = atEnd;
    }

    function stepSize(track) {
      const card = track.querySelector('.demo-card, .integration-card, .testimonial-card, article, .price-card');
      return (card?.getBoundingClientRect().width || 340) + 20;
    }

    function nudge(p, dir) {
      const step = stepSize(p.track) * dir;
      if (p.section.classList.contains('is-pinned') && p.distance > 0) {
        const rect = p.section.getBoundingClientRect();
        const current = Math.min(Math.max(-rect.top, 0), p.distance);
        const target = Math.min(Math.max(current + step, 0), p.distance);
        window.scrollBy({ top: target - current, behavior: 'smooth' });
      } else if (p.viewport) {
        p.viewport.scrollBy({ left: step, behavior: 'smooth' });
      }
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    function build() {
      pins.forEach((p) => {
        p.section.style.height = '';
        p.section.classList.remove('is-pinned', 'is-filled');
        p.track.style.transform = '';
      });
      pins = [];

      const wide = window.innerWidth >= 1600;
      const enablePin = window.innerWidth >= 900 && !reduce;

      sections.forEach((section) => {
        const viewport = section.querySelector('.pin-viewport');
        const track = section.querySelector('.pin-track');
        const fill = section.querySelector('.pin-progress-fill');
        const prev = section.querySelector('.carousel-prev');
        const next = section.querySelector('.carousel-next');
        if (!viewport || !track) return;

        const preferFill = (section.dataset.pinFill === 'lg' || section.dataset.pinFill === 'xl') && wide;
        let distance = 0;

        if (preferFill) {
          section.classList.add('is-filled');
        } else if (enablePin) {
          section.classList.add('is-pinned');
          distance = Math.max(0, track.scrollWidth - viewport.clientWidth);
          if (distance < 64) distance = 0;
          if (distance > 0) {
            const contentH = Math.max(track.offsetHeight + 56, 340);
            section.style.setProperty('--pin-h', contentH + 'px');
            section.style.height = (contentH + distance) + 'px';
          } else {
            section.classList.remove('is-pinned');
          }
        }

        const entry = { section, track, fill, distance, viewport, prev, next };
        pins.push(entry);
        updateNavState(entry);
      });

      update();
    }

    if (!window.__writeaiCarouselBound) {
      window.__writeaiCarouselBound = true;
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.carousel-prev, .carousel-next');
        if (!btn) return;
        const section = btn.closest('[data-pin]');
        const p = pins.find((x) => x.section === section);
        if (!p) return;
        nudge(p, btn.classList.contains('carousel-next') ? 1 : -1);
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(build, 150);
    });

    build();
    window.addEventListener('load', build);
    setTimeout(build, 400);
  }

  function initLampCta() {
    const section = document.getElementById('cta-lamp');
    const stage = section?.querySelector('.cta-lamp-stage');
    if (!section || !stage) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      stage.style.setProperty('--lamp', '0.9');
      return;
    }

    let ticking = false;

    function update() {
      ticking = false;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight || 1;

      if (rect.bottom < 0 || rect.top > vh) {
        stage.style.setProperty('--lamp', '0.08');
        return;
      }

      const center = rect.top + rect.height * 0.42;
      const ideal = vh * 0.38;
      const dist = Math.abs(center - ideal);
      const maxDist = vh * 0.7;
      let lamp = 1 - Math.min(dist / maxDist, 1);
      lamp = lamp * lamp * (3 - 2 * lamp);
      lamp = 0.12 + lamp * 0.88;
      stage.style.setProperty('--lamp', lamp.toFixed(3));
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function initFeatureModal() {
    const modal = document.getElementById('tool-modal');
    const titleEl = document.getElementById('tool-modal-title');
    const bodyEl = document.getElementById('tool-modal-body');
    if (!modal || !bodyEl) return;

    const tools = {
      fix: {
        title: 'Fix grammar',
        sample: 'Please send the file tommorow so we can review it.',
        run: (t) => t
          .replace(/\btommorow\b/gi, 'tomorrow')
          .replace(/\brecieve\b/gi, 'receive')
          .replace(/\bteh\b/gi, 'the')
          .replace(/\bi\b/g, 'I')
          .replace(/\s+/g, ' ')
          .trim()
      },
      translate: {
        title: 'Translate',
        sample: 'Please send the file tomorrow so we can review it.',
        run: () => 'يرجى إرسال الملف غداً حتى نتمكن من مراجعته.'
      },
      rephrase: {
        title: 'Rephrase',
        sample: 'hey can u check this when u get a chance',
        run: () => 'Hi — could you review this when you have a moment? Thanks.'
      },
      summarize: {
        title: 'Summarize',
        sample: 'Sprint goals are mostly on track. Two tickets are still blocked on design review. Hiring is open for one backend role. Next week’s launch checklist is due Friday and needs owners assigned.',
        run: () => 'Goals on track. Two tickets blocked. One open hire. Launch checklist due Friday.'
      },
      explain: {
        title: 'Explain',
        sample: 'We need to debounce the input handler before firing the network request.',
        run: () => 'In plain terms: wait until the user stops typing for a moment, then send the request — so you don’t spam the server with every keystroke.'
      },
      chat: {
        title: 'Web chat',
        guide: [
          'Open the Writect web app after signing in.',
          'Describe the email, post, or outline you need.',
          'Copy the draft or refine it with follow-up prompts.'
        ]
      },
      page: {
        title: 'Page Assistant',
        guide: [
          'Install the Chrome extension and pin Writect.',
          'Click the toolbar icon to open the side panel on any page.',
          'Summarize, pull key points, or ask a question about the page.'
        ]
      },
      menu: {
        title: 'Right-click menu',
        guide: [
          'Highlight text on a page.',
          'Right-click and open the Writect menu.',
          'Pick Fix, Rephrase, Translate, or Summarize.'
        ]
      },
      replace: {
        title: 'Replace in place',
        guide: [
          'Select text inside an editable field (Gmail, Docs, Slack…).',
          'Run a Writect action from the toolbar.',
          'Choose Replace to swap the selection with the improved text.'
        ]
      }
    };

    function close() {
      modal.hidden = true;
      document.body.style.overflow = '';
    }

    function openInteractive(tool) {
      bodyEl.innerHTML = `
        <div class="tool-workspace">
          <div class="tool-pane">
            <label>Your text</label>
            <textarea id="tool-input">${tool.sample}</textarea>
          </div>
          <div class="tool-pane tool-pane-out">
            <label>Writect result</label>
            <div class="tool-out-text is-empty" id="tool-output">Your improved draft shows up here.</div>
          </div>
        </div>
        <div class="tool-actions">
          <button type="button" class="btn btn-primary" id="tool-run">✨ Run ${tool.title}</button>
          <button type="button" class="btn btn-secondary" id="tool-copy">Copy result</button>
        </div>
        <p class="tool-hint">Live preview on this page — sign in for full models, languages, and replace-in-place on real sites.</p>
      `;
      const input = bodyEl.querySelector('#tool-input');
      const output = bodyEl.querySelector('#tool-output');
      bodyEl.querySelector('#tool-run')?.addEventListener('click', () => {
        output.classList.remove('is-empty');
        output.textContent = 'Working…';
        setTimeout(() => {
          const result = tool.run(input.value || '');
          output.textContent = result;
          if (tool.title === 'Translate') {
            output.dir = 'rtl';
            output.lang = 'ar';
          } else {
            output.dir = 'ltr';
            output.lang = 'en';
          }
        }, 420);
      });
      bodyEl.querySelector('#tool-copy')?.addEventListener('click', async () => {
        const text = output?.textContent || '';
        if (!text || output.classList.contains('is-empty')) return;
        try {
          await navigator.clipboard.writeText(text);
          showToast('Copied');
        } catch {
          showToast('Could not copy');
        }
      });
    }

    function openGuide(tool) {
      bodyEl.innerHTML = `
        <div class="tool-guide">
          ${tool.guide.map((step, i) => `
            <div class="tool-guide-step">
              <b>${i + 1}</b>
              <span>${step}</span>
            </div>
          `).join('')}
        </div>
        <p class="tool-hint">Install the extension to use this on Gmail, Docs, Slack, and more — or open the web app for longer drafts.</p>
        <div class="tool-actions">
          <button type="button" class="btn btn-chrome" data-install-ext>
            <img class="chrome-logo" src="/img/chrome.svg" width="18" height="18" alt="">
            Install Free Chrome Extension
          </button>
          <a href="/login" class="btn btn-primary">Open web app</a>
        </div>
      `;
      bodyEl.querySelectorAll('[data-install-ext]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          installExtension();
        });
      });
    }

    function open(key) {
      const tool = tools[key];
      if (!tool) return;
      titleEl.textContent = tool.title;
      if (tool.guide) openGuide(tool);
      else openInteractive(tool);
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
    }

    document.querySelectorAll('.feature-card[data-tool]').forEach((card) => {
      card.addEventListener('click', () => open(card.dataset.tool));
    });
    modal.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', close);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
  }

  function initIntegrationWriting() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cards = document.querySelectorAll('.integration-card');
    if (!cards.length) return;

    cards.forEach((card) => {
      const textEl = card.querySelector('.mock-write-text');
      if (!textEl) return;
      const full = (textEl.textContent || '').trim();
      textEl.dataset.full = full;
      let timer = null;

      function stop() {
        clearInterval(timer);
        timer = null;
        card.classList.remove('is-writing');
        textEl.textContent = full;
      }

      function start() {
        if (reduce) return;
        stop();
        card.classList.add('is-writing');
        let i = 0;
        textEl.textContent = '';
        timer = setInterval(() => {
          i += 1;
          textEl.textContent = full.slice(0, i);
          if (i >= full.length) {
            clearInterval(timer);
            timer = null;
            setTimeout(() => card.classList.remove('is-writing'), 400);
          }
        }, 18);
      }

      card.addEventListener('mouseenter', start);
      card.addEventListener('mouseleave', stop);
      card.addEventListener('focusin', start);
      card.addEventListener('focusout', stop);
    });
  }

  function initExtensionButtons() {
    document.querySelectorAll('[data-install-ext]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        installExtension();
      });
    });
  }

  // Boot — stay on marketing site even if signed in (show Account instead of Sign in)
  applyTheme('light');

  function syncLandingAuthNav() {
    const signedIn = !!window.WriteAIApi?.getToken?.();
    document.querySelectorAll('[data-auth-guest]').forEach((el) => {
      el.hidden = signedIn;
    });
    document.querySelectorAll('[data-auth-user]').forEach((el) => {
      el.hidden = !signedIn;
    });
  }

  async function initLandingAuth() {
    if (!window.WriteAIApi?.getToken?.()) {
      try { await WriteAIApi.syncFromExtension?.(); } catch { /* ignore */ }
    }
    syncLandingAuthNav();

    // Logged-in users clicking Pro CTA go straight to checkout in the app
    document.querySelectorAll('[data-upgrade-cta]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (!WriteAIApi.getToken?.()) return;
        e.preventDefault();
        const interval = el.getAttribute('data-interval') || 'month';
        try { sessionStorage.setItem('writect_billing_interval', interval); } catch { /* ignore */ }
        location.href = `/app?upgrade=1&interval=${encodeURIComponent(interval)}`;
      });
    });
  }

  function initPricingToggle() {
    const toggle = document.querySelector('.pricing-toggle');
    const card = document.getElementById('pro-price-card');
    if (!toggle || !card) return;

    const amountEl = card.querySelector('[data-pro-amount]');
    const periodEl = card.querySelector('[data-pro-period]');
    const noteEl = card.querySelector('[data-pro-note]');
    const yearlyExtras = card.querySelector('[data-pro-yearly]');
    const compareEl = card.querySelector('[data-pro-compare]');
    const equivEl = card.querySelector('[data-pro-equiv]');
    const ctaEl = card.querySelector('[data-pro-cta]');
    const buttons = [...toggle.querySelectorAll('[data-billing]')];

    function setBilling(interval) {
      const isYear = interval === 'year';
      if (amountEl) {
        amountEl.textContent = isYear ? card.dataset.yearAmount : card.dataset.monthAmount;
      }
      if (periodEl) {
        periodEl.textContent = isYear ? card.dataset.yearPeriod : card.dataset.monthPeriod;
      }
      if (noteEl) {
        noteEl.textContent = card.dataset.monthNote;
        noteEl.hidden = isYear;
      }
      if (yearlyExtras) yearlyExtras.hidden = !isYear;
      if (compareEl) compareEl.textContent = card.dataset.yearCompare;
      if (equivEl) equivEl.textContent = card.dataset.yearEquiv;
      card.classList.toggle('is-yearly', isYear);

      if (ctaEl) {
        ctaEl.setAttribute('data-interval', interval);
        const href = ctaEl.getAttribute('href') || '/login?upgrade=1';
        try {
          const url = new URL(href, location.origin);
          url.searchParams.set('upgrade', '1');
          url.searchParams.set('interval', interval);
          ctaEl.setAttribute('href', `${url.pathname}${url.search}`);
        } catch {
          ctaEl.setAttribute('href', `/login?upgrade=1&interval=${interval}`);
        }
      }
      buttons.forEach((btn) => {
        const active = btn.dataset.billing === interval;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      try { sessionStorage.setItem('writect_billing_interval', interval); } catch { /* ignore */ }
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => setBilling(btn.dataset.billing === 'year' ? 'year' : 'month'));
    });

    let initial = 'month';
    try {
      const stored = sessionStorage.getItem('writect_billing_interval');
      if (stored === 'year' || stored === 'month') initial = stored;
    } catch { /* ignore */ }
    setBilling(initial);
  }

  initLandingAuth();
  initPricingToggle();
  initHeroTyping();
  initReveal();
  initMobileNav();
  initExtensionButtons();
  initPins();
  initLampCta();
  initFeatureModal();
  initIntegrationWriting();
})();
