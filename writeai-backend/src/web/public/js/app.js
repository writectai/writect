(function () {
  const $ = (id) => document.getElementById(id);

  let user = null;
  let models = [];
  let currentChatId = null;
  let chats = loadChats();
  let selectedLength = 'medium';
  let isSending = false;
  let pendingAttachments = [];
  let voiceSession = null;
  let voiceTranscript = '';
  let voiceSendOnEnd = false;

  const ACTIVE_CHAT_KEY = 'writeai_active_chat';

  function chatPath(id) {
    return id ? `/app/c/${encodeURIComponent(id)}` : '/app';
  }

  function settingsPath() {
    return '/app/settings';
  }

  function setAppRoute(path, { replace = false } = {}) {
    const next = path || '/app';
    if (location.pathname === next) return;
    if (replace) history.replaceState({ path: next }, '', next);
    else history.pushState({ path: next }, '', next);
  }

  function parseAppRoute() {
    const path = (location.pathname || '/app').replace(/\/+$/, '') || '/app';
    if (path === '/app/settings') return { view: 'settings' };
    const m = path.match(/^\/app\/c\/([^/]+)$/);
    if (m) return { view: 'chat', id: decodeURIComponent(m[1]) };
    return { view: 'home' };
  }

  const PROMPTS = {
    short: 'Keep the response concise — about 1–2 short paragraphs. Still finish every sentence completely.',
    medium: 'Give a helpful, complete response with enough detail to be useful (similar depth to a strong writing chat). Prefer a ready-to-use draft or clear options over a clipped one-liner. Finish every sentence and section.',
    long: 'Provide a thorough, detailed response with structure and examples where helpful. Complete every section and template fully — never truncate.'
  };

  function loadChats() {
    try { return JSON.parse(localStorage.getItem('writeai_chats') || '[]'); }
    catch { return []; }
  }

  function saveChats() {
    localStorage.setItem('writeai_chats', JSON.stringify(chats.slice(0, 30)));
    if (currentChatId) localStorage.setItem(ACTIVE_CHAT_KEY, currentChatId);
    else localStorage.removeItem(ACTIVE_CHAT_KEY);
  }

  function clearVoiceUi() {
    const btn = $('voice-btn');
    if (!btn) return;
    btn.classList.remove('is-listening');
    btn.setAttribute('aria-pressed', 'false');
  }

  function abortVoice({ sendOnEnd = false } = {}) {
    voiceSendOnEnd = !!sendOnEnd;
    try { voiceSession?.abort(); } catch { /* ignore */ }
    voiceSession = null;
    clearVoiceUi();
  }

  function stopVoiceForSend() {
    // Commit listening → onEnd may fire; we do NOT want a second auto-send.
    voiceSendOnEnd = false;
    const snapshot = (voiceTranscript || $('chat-input')?.value || '').trim();
    try { voiceSession?.abort(); } catch { /* ignore */ }
    voiceSession = null;
    clearVoiceUi();
    voiceTranscript = '';
    return snapshot;
  }

  const THEME_KEY = 'writeai_web_theme';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    $('theme-icon-dark')?.classList.toggle('hidden', theme === 'light');
    $('theme-icon-light')?.classList.toggle('hidden', theme !== 'light');
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  }

  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3200);
  }

  function initials(name, email) {
    const src = name || email || 'U';
    return src.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function formatNum(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function formatResetDate(isoDate) {
    if (!isoDate) return '—';
    const d = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  }

  /** Live-update AI action counters without a full page reload. */
  function applyUsagePayload(usage) {
    if (!user || !usage || typeof usage !== 'object') return false;
    user = {
      ...user,
      usage: { ...(user.usage || {}), ...usage },
      plan: usage.plan || user.plan
    };
    renderUser();
    return true;
  }

  function bumpUsageOptimistic(actionCost = 1) {
    if (!user) return;
    const cost = Math.max(1, Number(actionCost) || 1);
    const usage = { ...(user.usage || {}) };
    usage.count = (usage.count || 0) + cost;
    if (usage.remaining != null) usage.remaining = Math.max(0, usage.remaining - cost);
    usage.daily_count = (usage.daily_count || 0) + cost;
    if (usage.daily_remaining != null) {
      usage.daily_remaining = Math.max(0, usage.daily_remaining - cost);
    }
    applyUsagePayload(usage);
  }

  async function refreshUsageAfterAction(data = {}) {
    if (data.usage) {
      applyUsagePayload(data.usage);
      return;
    }
    bumpUsageOptimistic(data.action_cost || 1);
    try {
      const meRes = await WriteAIApi.apiFetch('/user/me');
      if (meRes.ok && meRes.data?.usage) {
        user = { ...user, ...meRes.data, usage: meRes.data.usage };
        renderUser();
      }
    } catch {
      /* keep optimistic numbers */
    }
  }

  function captureTokenFromHash() {
    const hash = location.hash.slice(1);
    if (!hash.startsWith('token=')) return;
    const token = decodeURIComponent(hash.slice(6));
    WriteAIApi.setToken(token);
    WriteAIApi.pushTokenToExtension(token);
    history.replaceState(null, '', location.pathname + location.search);
  }

  async function requireAuth() {
    captureTokenFromHash();
    if (!WriteAIApi.getToken()) {
      await WriteAIApi.syncFromExtension();
    }
    if (!WriteAIApi.getToken()) {
      location.href = '/login';
      return false;
    }

    const { ok, data } = await WriteAIApi.apiFetch('/auth/verify');
    if (!ok) {
      WriteAIApi.setToken('');
      WriteAIApi.signOutExtension();
      location.href = '/login';
      return false;
    }
    // Seed user early so chat works even if /user/me is slow/fails
    if (data?.user) {
      user = {
        ...data.user,
        usage: data.user.usage || { count: 0, limit: null }
      };
    }
    return true;
  }

  async function loadUser() {
    const [meRes, modelsRes] = await Promise.all([
      WriteAIApi.apiFetch('/user/me'),
      WriteAIApi.apiFetch('/user/models')
    ]);

    if (!meRes.ok) {
      throw new Error(meRes.data?.message || 'Failed to load profile');
    }

    user = {
      ...meRes.data,
      usage: meRes.data.usage || {
        count: 0,
        limit: meRes.data.plan === 'pro' ? 3000 : 300,
        remaining: meRes.data.plan === 'pro' ? 3000 : 300,
        daily_count: 0,
        daily_limit: meRes.data.plan === 'pro' ? 150 : 10,
        daily_remaining: meRes.data.plan === 'pro' ? 150 : 10,
        resets_at: null
      }
    };
    models = modelsRes.ok ? (modelsRes.data.models || []) : [];

    renderUser();
    renderModels();
    renderBilling();
    handleQueryParams();
  }

  function subscriptionLabel(status, isPro) {
    if (!isPro) return 'Not subscribed';
    const map = {
      active: 'Active',
      trialing: 'Trial',
      past_due: 'Past due — update payment',
      canceled: 'Canceled',
      none: 'Active (admin)'
    };
    return map[status] || status || 'Active';
  }

  function renderUser() {
    if (!user) return;
    const isPro = user.plan === 'pro';
    const name = user.name || (user.email ? user.email.split('@')[0] : 'User');
    const usage = user.usage || {};
    const count = usage.count || 0;
    const limit = usage.limit;
    const remaining = usage.remaining != null
      ? usage.remaining
      : (limit != null ? Math.max(0, limit - count) : null);
    const dailyCount = usage.daily_count || 0;
    const dailyLimit = usage.daily_limit;
    const subStatus = user.subscription_status || (isPro ? 'active' : 'none');

    $('sidebar-name').textContent = name;
    $('sidebar-plan').textContent = isPro ? 'Pro plan' : 'Free plan';
    if ($('settings-name')) $('settings-name').textContent = name;
    if ($('settings-email')) $('settings-email').textContent = user.email || '';
    if ($('password-box-email')) $('password-box-email').textContent = user.email || '—';
    if ($('settings-username') && document.activeElement !== $('settings-username')) {
      $('settings-username').value = user.name || '';
      $('settings-username').placeholder = user.email
        ? user.email.split('@')[0]
        : 'Your display name';
    }
    if ($('settings-signin-method')) {
      $('settings-signin-method').textContent = user.sign_in_method
        || (user.has_password ? 'Email & password' : 'Google');
    }
    syncPasswordBox();

    const badge = $('plan-badge');
    if (badge) {
      badge.textContent = isPro ? 'Pro' : 'Free';
      badge.className = `badge ${isPro ? 'badge-pro' : 'badge-free'}`;
    }

    if ($('settings-plan')) {
      $('settings-plan').textContent = isPro ? 'Pro — Higher limits' : 'Free';
    }
    if ($('settings-subscription')) {
      $('settings-subscription').textContent = subscriptionLabel(subStatus, isPro);
    }
    if ($('settings-price')) {
      $('settings-price').textContent = isPro ? '$9.99 / month' : '$0 / month';
    }

    const note = $('subscription-note');
    if (note) {
      if (limit != null && count >= limit) {
        note.hidden = false;
        note.textContent = isPro
          ? `You've used all Pro AI actions this month. Usage resets on ${formatResetDate(usage.resets_at)}.`
          : 'You have used all free AI actions this month. Upgrade to Pro for higher limits.';
      } else if (dailyLimit != null && dailyCount >= dailyLimit) {
        note.hidden = false;
        note.textContent = "You've reached today's AI action limit. Try again tomorrow.";
      } else if (isPro && !user.has_billing) {
        note.hidden = false;
        note.textContent = 'Your Pro plan was assigned by an admin. No Stripe billing account is linked.';
      } else if (subStatus === 'past_due') {
        note.hidden = false;
        note.textContent = 'Payment failed. Update your card in Manage billing to keep Pro access.';
      } else {
        note.hidden = true;
        note.textContent = '';
      }
    }

    const avatarEl = $('sidebar-avatar');
    if (avatarEl) {
      if (user.avatar_url) {
        avatarEl.innerHTML = `<img src="${user.avatar_url}" alt="">`;
      } else {
        avatarEl.textContent = initials(user.name, user.email);
      }
    }

    if ($('usage-actions-text')) {
      if (limit != null) {
        $('usage-actions-text').textContent = `${formatNum(count)} / ${formatNum(limit)} used`;
        const pct = Math.min(100, Math.round((count / Math.max(limit, 1)) * 100));
        if ($('usage-bar-fill')) $('usage-bar-fill').style.width = `${pct}%`;
        $('usage-bar-wrap')?.classList.remove('hidden');
        if ($('usage-remaining')) {
          $('usage-remaining').textContent = `${formatNum(remaining)} actions remaining`;
        }
      } else {
        $('usage-actions-text').textContent = `${formatNum(count)} used`;
        $('usage-bar-wrap')?.classList.add('hidden');
        if ($('usage-remaining')) $('usage-remaining').textContent = 'No monthly action cap';
      }

      if ($('usage-daily-text')) {
        $('usage-daily-text').textContent = dailyLimit != null
          ? `${formatNum(dailyCount)} / ${formatNum(dailyLimit)} actions`
          : `${formatNum(dailyCount)} actions today`;
      }
      if ($('usage-daily-reset')) {
        $('usage-daily-reset').textContent = 'Every day at 00:00 UTC';
      }
      if ($('usage-resets-text')) {
        const monthly = formatResetDate(usage.resets_at);
        $('usage-resets-text').textContent = monthly === '—'
          ? '—'
          : `${monthly} (00:00 UTC)`;
      }
      $('usage-upgrade-hint')?.classList.toggle('hidden', isPro);
    }

    applyPlanUiRestrictions();
    renderTopUpgrade();
  }

  function applyPlanUiRestrictions() {
    const isPro = user?.plan === 'pro';
    const longBtn = document.querySelector('#length-group [data-length="long"]');
    if (longBtn) {
      longBtn.disabled = !isPro;
      longBtn.title = isPro ? '' : 'Long answers are available on Pro';
      longBtn.classList.toggle('is-locked', !isPro);
      if (!isPro && selectedLength === 'long') {
        selectedLength = 'medium';
        document.querySelectorAll('#length-group .tool-chip').forEach((b) => {
          b.classList.toggle('active', b.dataset.length === 'medium');
        });
      }
    }
  }

  function renderTopUpgrade() {
    let btn = $('top-upgrade-btn');
    if (!user || user.plan === 'pro') {
      btn?.remove();
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'top-upgrade-btn';
      btn.type = 'button';
      btn.className = 'btn btn-primary top-upgrade-btn';
      btn.textContent = 'Upgrade to Pro';
      btn.addEventListener('click', startCheckout);
      $('topbar-actions')?.prepend(btn);
    }
  }

  function providerOf(model) {
    if (!model) return 'openai';
    if (model.provider) return model.provider;
    const id = String(model.id || model.label || '').toLowerCase();
    return id.includes('gemini') ? 'gemini' : 'openai';
  }

  function closeModelPicker() {
    const picker = $('model-picker');
    const menu = $('model-picker-menu');
    const trigger = $('model-picker-trigger');
    if (!picker) return;
    picker.classList.remove('is-open');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function displayModelName(model) {
    const raw = String(model?.label || model?.id || 'Select model');
    return raw.replace(/\s*\(recommended\)\s*/i, '').trim() || raw;
  }

  function isRecommendedModel(model) {
    return /\(recommended\)/i.test(String(model?.label || ''));
  }

  function syncModelPickerLabel() {
    const sel = $('model-select');
    const label = $('model-picker-label');
    const mark = document.querySelector('.model-picker-mark');
    if (!sel || !label) return;
    const model = models.find((m) => m.id === sel.value);
    const opt = sel.options[sel.selectedIndex];
    const text = model ? displayModelName(model) : (opt?.textContent || 'Select model');
    label.textContent = text;
    const provider = providerOf(model || { id: sel.value, label: text });
    if (mark) {
      mark.textContent = provider === 'gemini' ? 'G' : 'AI';
      mark.classList.toggle('is-gemini', provider === 'gemini');
    }
    $('model-picker-trigger')?.setAttribute('title', sel.title || 'AI model');
  }

  function renderModelPickerMenu() {
    const menu = $('model-picker-menu');
    const sel = $('model-select');
    if (!menu || !sel) return;
    menu.innerHTML = '';
    if (!models.length) {
      const empty = document.createElement('div');
      empty.className = 'model-picker-empty';
      empty.textContent = 'Default model';
      menu.appendChild(empty);
      return;
    }

    const header = document.createElement('div');
    header.className = 'model-picker-heading';
    header.textContent = 'Choose a model';
    menu.appendChild(header);

    const groups = [
      { key: 'openai', title: 'OpenAI' },
      { key: 'gemini', title: 'Google Gemini' }
    ];
    const byProvider = { openai: [], gemini: [] };
    models.forEach((m) => {
      byProvider[providerOf(m)]?.push(m);
    });

    groups.forEach((group) => {
      const list = byProvider[group.key];
      if (!list?.length) return;
      const section = document.createElement('div');
      section.className = 'model-picker-section';
      const title = document.createElement('div');
      title.className = 'model-picker-section-title';
      title.textContent = group.title;
      section.appendChild(title);

      list.forEach((m) => {
        const provider = providerOf(m);
        const selected = sel.value === m.id;
        const recommended = isRecommendedModel(m);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'model-picker-option'
          + (selected ? ' is-selected' : '')
          + (recommended ? ' is-recommended' : '');
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        btn.dataset.value = m.id;
        btn.innerHTML = `
          <span class="model-picker-option-icon${provider === 'gemini' ? ' is-gemini' : ''}" aria-hidden="true">${provider === 'gemini' ? 'G' : 'AI'}</span>
          <span class="model-picker-option-text">
            <span class="model-picker-option-row">
              <span class="model-picker-option-name"></span>
              ${recommended ? '<span class="model-picker-badge">Recommended</span>' : ''}
            </span>
            <span class="model-picker-option-meta"></span>
          </span>
          <span class="model-picker-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>
          </span>
        `;
        btn.querySelector('.model-picker-option-name').textContent = displayModelName(m);
        btn.querySelector('.model-picker-option-meta').textContent = m.free ? 'Available on Free' : 'Pro model';
        btn.addEventListener('click', () => {
          sel.value = m.id;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          syncModelPickerLabel();
          renderModelPickerMenu();
          closeModelPicker();
        });
        section.appendChild(btn);
      });
      menu.appendChild(section);
    });
  }

  function renderModels() {
    const sel = $('model-select');
    if (!sel) return;
    sel.innerHTML = '';
    if (!models.length) {
      sel.innerHTML = '<option value="">Default model</option>';
      syncModelPickerLabel();
      renderModelPickerMenu();
      return;
    }
    models.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label || m.id;
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    });
    if (user?.plan !== 'pro') {
      sel.title = 'Free plan: lite models only. Upgrade for all models.';
    } else {
      sel.title = 'AI model';
    }
    syncModelPickerLabel();
    renderModelPickerMenu();
  }

  function initModelPicker() {
    const picker = $('model-picker');
    const trigger = $('model-picker-trigger');
    const menu = $('model-picker-menu');
    if (!picker || !trigger || !menu || picker.dataset.ready) return;
    picker.dataset.ready = '1';

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = picker.classList.toggle('is-open');
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) renderModelPickerMenu();
    });

    document.addEventListener('click', (e) => {
      if (!picker.contains(e.target)) closeModelPicker();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModelPicker();
    });
  }

  function renderBilling() {
    const wrap = $('billing-actions');
    if (!wrap || !user) return;
    wrap.innerHTML = '';
    const isPro = user.plan === 'pro';
    const hasBilling = user.has_billing;
    const billingConfigured = user.billing_configured !== false;

    if (!isPro) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = billingConfigured ? 'Upgrade to Pro — $9.99/mo' : 'Upgrade to Pro — $9.99/mo';
      btn.addEventListener('click', startCheckout);
      wrap.appendChild(btn);

      const features = document.createElement('ul');
      features.className = 'plan-features';
      features.innerHTML = `
        <li>3,000 AI actions/month · 150/day</li>
        <li>All AI models &amp; long answers</li>
        <li>Chrome Extension + Web App</li>
        <li>Selection tools + Full Page Assistant</li>
        <li>Cancel anytime in Stripe portal</li>`;
      wrap.appendChild(features);
      return;
    }

    if (hasBilling) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.textContent = 'Manage billing';
      btn.addEventListener('click', openPortal);
      wrap.appendChild(btn);
    } else {
      const note = document.createElement('p');
      note.className = 'security-note';
      note.textContent = 'Your Pro plan was assigned by an admin. No billing account is linked.';
      wrap.appendChild(note);
    }
  }

  async function startCheckout() {
    const { ok, data } = await WriteAIApi.apiFetch('/billing/checkout', { method: 'POST' });
    if (!ok) {
      showToast(data.message || 'Could not start checkout.');
      if (data.error === 'billing_not_configured') {
        showSettings();
      }
      return;
    }
    location.href = data.url;
  }

  async function openPortal() {
    const { ok, data } = await WriteAIApi.apiFetch('/billing/portal', { method: 'POST' });
    if (!ok) return showToast(data.message || 'Could not open billing portal.');
    location.href = data.url;
  }

  function handleQueryParams() {
    const params = new URLSearchParams(location.search);
    const route = parseAppRoute();
    const basePath = route.view === 'settings'
      ? settingsPath()
      : route.view === 'chat'
        ? chatPath(route.id)
        : '/app';

    if (params.get('upgraded') === '1') {
      showToast('Welcome to Pro! You now have higher AI action limits.');
      history.replaceState(null, '', basePath);
      loadUser();
    }
    if (params.get('billing') === 'cancel') {
      showToast('Checkout canceled.');
      history.replaceState(null, '', basePath);
    }
    if (params.get('upgrade') === '1') {
      showSettings();
      history.replaceState(null, '', settingsPath());
      showToast('Upgrade to Pro for higher limits and all models.');
    }
    if (params.get('view') === 'settings') {
      showSettings();
      setAppRoute(settingsPath(), { replace: true });
    }
  }

  function showChat() {
    $('chat-view').classList.remove('hidden');
    $('settings-view').classList.add('hidden');
    $('view-title').textContent = 'Chat';
    $('nav-chat').classList.add('active');
    document.documentElement.dataset.appRoute = currentChatId ? 'chat' : 'home';
  }

  function showSettings({ syncRoute = true } = {}) {
    $('chat-view').classList.add('hidden');
    $('settings-view').classList.remove('hidden');
    $('view-title').textContent = 'Settings';
    $('nav-chat').classList.remove('active');
    document.documentElement.dataset.appRoute = 'settings';
    if (syncRoute) setAppRoute(settingsPath(), { replace: location.pathname === settingsPath() });
  }

  function newChat() {
    currentChatId = null;
    localStorage.removeItem(ACTIVE_CHAT_KEY);
    setAppRoute('/app');
    $('chat-messages').innerHTML = `
      <div class="chat-empty" id="chat-empty">
        <h2>How can we help you today?</h2>
        <div class="prompt-grid">
          <button class="prompt-card" data-prompt="Draft a polite follow-up email checking on a job application.">Draft a polite follow-up email checking on a job application.</button>
          <button class="prompt-card" data-prompt="Write a short LinkedIn post announcing a product launch.">Write a short LinkedIn post announcing a product launch.</button>
          <button class="prompt-card" data-prompt="Improve this sentence to sound more professional: Thanks for getting back to me so fast.">Improve this sentence to sound more professional.</button>
          <button class="prompt-card" data-prompt="Summarize the key points of a meeting about Q3 planning.">Summarize the key points of a meeting about Q3 planning.</button>
        </div>
      </div>`;
    bindPromptCards();
    renderHistory();
    showChat();
  }

  function bindPromptCards() {
    document.querySelectorAll('.prompt-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('chat-input').value = btn.dataset.prompt;
        updateSendState();
        sendMessage();
      });
    });
  }

  function renderHistory() {
    const list = $('history-list');
    list.innerHTML = '<div class="history-label">Recent</div>';
    chats.forEach((chat) => {
      const btn = document.createElement('button');
      btn.className = `history-item${chat.id === currentChatId ? ' active' : ''}`;
      btn.textContent = chat.title;
      btn.addEventListener('click', () => openChat(chat.id));
      list.appendChild(btn);
    });
  }

  function openChat(id, { replace = false } = {}) {
    const chat = chats.find((c) => c.id === id);
    if (!chat) return false;
    currentChatId = id;
    localStorage.setItem(ACTIVE_CHAT_KEY, id);
    setAppRoute(chatPath(id), { replace });
    $('chat-empty')?.remove();
    $('chat-messages').innerHTML = '';
    chat.messages.forEach((m) => appendMessage(m.role, m.content, false, m.attachments || []));
    renderHistory();
    showChat();
    return true;
  }

  function restoreFromRoute() {
    const route = parseAppRoute();
    if (route.view === 'settings') {
      showSettings({ syncRoute: false });
      return true;
    }
    if (route.view === 'chat' && route.id) {
      if (openChat(route.id, { replace: true })) return true;
      // Unknown/missing chat id → home
      setAppRoute('/app', { replace: true });
      return false;
    }
    return false;
  }

  function appendUpgradePrompt(message) {
    $('chat-empty')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    wrap.innerHTML = `
      <div class="msg-avatar">W</div>
      <div class="msg-body">
        <div class="upgrade-card">
          <p>⚠️ ${escapeHtml(message)}</p>
          <p class="upgrade-card-sub">Pro unlocks higher limits, all models, and long answers for $9.99/month. Cancel anytime.</p>
          <button type="button" class="btn btn-primary" id="chat-upgrade-btn">Upgrade to Pro — $9.99/mo</button>
        </div>
      </div>`;
    $('chat-messages').appendChild(wrap);
    $('chat-upgrade-btn')?.addEventListener('click', startCheckout);
    $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  }

  function appendMessage(role, content, scroll = true, attachments = []) {
    $('chat-empty')?.remove();
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;
    const avatarText = role === 'user'
      ? initials(user?.name, user?.email)
      : 'W';
    const attachHtml = renderAttachmentsHtml(attachments);
    wrap.innerHTML = `
      <div class="msg-avatar">${role === 'assistant' ? 'W' : avatarText}</div>
      <div class="msg-body">${attachHtml}${formatContent(content, role)}</div>`;
    $('chat-messages').appendChild(wrap);
    if (scroll) $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
    return wrap;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(text) {
    if (!text) return '';

    const codeBlocks = [];
    let src = text.replace(/```([\s\S]*?)```/g, (_, code) => {
      const i = codeBlocks.length;
      codeBlocks.push(`<pre><code>${escapeHtml(code.trim())}</code></pre>`);
      return `\x00CB${i}\x00`;
    });

    const lines = src.split('\n');
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
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }

    function isQuoteLine(trimmed) {
      return trimmed === '>' || trimmed.startsWith('> ');
    }

    function quoteBody(trimmed) {
      if (trimmed === '>') return '';
      return trimmed.replace(/^>\s?/, '');
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      const trimmed = line.trim();

      if (!trimmed) { closeLists(); continue; }

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

      if (isQuoteLine(trimmed)) {
        closeLists();
        const parts = [];
        while (i < lines.length) {
          const qTrim = lines[i].trimEnd().trim();
          if (!isQuoteLine(qTrim)) break;
          parts.push(quoteBody(qTrim));
          i += 1;
        }
        i -= 1; // for-loop will advance

        const htmlParas = parts
          .join('\n')
          .split(/\n\s*\n/)
          .map((block) => {
            const rows = block.split('\n').map((r) => inline(r.trim())).filter((r) => r.length);
            if (!rows.length) return '';
            return `<p>${rows.join('<br>')}</p>`;
          })
          .filter(Boolean);

        if (htmlParas.length) {
          out.push(`<blockquote>${htmlParas.join('')}</blockquote>`);
        }
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

    let html = out.join('');
    html = html.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[Number(i)] || '');
    return html;
  }

  function formatContent(text, role) {
    if (role === 'assistant') return renderMarkdown(text);
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function renderAttachmentsHtml(attachments) {
    if (!attachments?.length) return '';
    const items = attachments.map((a) => {
      if (a.type === 'image') {
        return `<img class="msg-attach-img" src="${a.dataUrl}" alt="${escapeHtml(a.name)}">`;
      }
      return `<span class="msg-attach-file">📎 ${escapeHtml(a.name)}</span>`;
    }).join('');
    return `<div class="msg-attachments">${items}</div>`;
  }

  function ensureChat(title) {
    if (currentChatId) {
      const existing = chats.find((c) => c.id === currentChatId);
      if (existing) {
        setAppRoute(chatPath(existing.id), { replace: true });
        return existing;
      }
    }
    const chat = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: title.slice(0, 48) + (title.length > 48 ? '…' : ''),
      messages: [],
      updatedAt: Date.now()
    };
    chats.unshift(chat);
    currentChatId = chat.id;
    saveChats();
    setAppRoute(chatPath(chat.id), { replace: true });
    renderHistory();
    return chat;
  }

  function updateSendState() {
    const input = $('chat-input');
    const hasContent = input.value.trim() || pendingAttachments.length;
    $('send-btn').disabled = !hasContent || isSending;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async function addAttachment(file) {
    if (!file) return;
    const isImage = file.type.startsWith('image/');
    const isText = /\.(txt|md|csv|json)$/i.test(file.name) || file.type.startsWith('text/');

    if (!isImage && !isText && file.type !== 'application/pdf') {
      showToast('Supported: images, .txt, .md, .csv, .json');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('File must be under 5 MB.');
      return;
    }

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: file.name,
      type: isImage ? 'image' : 'file',
      mime: file.type
    };

    if (isImage) {
      item.dataUrl = await readFileAsDataUrl(file);
    } else if (isText) {
      item.textContent = await readFileAsText(file);
    } else {
      showToast('PDF preview not supported yet. Describe what you need in your message.');
      return;
    }

    pendingAttachments.push(item);
    renderAttachPreview();
    updateSendState();
  }

  function removeAttachment(id) {
    pendingAttachments = pendingAttachments.filter((a) => a.id !== id);
    renderAttachPreview();
    updateSendState();
  }

  function renderAttachPreview() {
    const wrap = $('attach-preview');
    if (!pendingAttachments.length) {
      wrap.classList.add('hidden');
      wrap.innerHTML = '';
      return;
    }

    wrap.classList.remove('hidden');
    wrap.innerHTML = pendingAttachments.map((a) => `
      <div class="attach-item" data-id="${a.id}">
        ${a.type === 'image' ? `<img src="${a.dataUrl}" alt="">` : '<span>📎</span>'}
        <span class="attach-name">${escapeHtml(a.name)}</span>
        <button class="attach-remove" type="button" data-remove="${a.id}" aria-label="Remove">×</button>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => removeAttachment(btn.dataset.remove));
    });
  }

  function buildApiText(text, attachments) {
    const parts = [text];

    attachments.forEach((a) => {
      if (a.type === 'image') {
        parts.push(`\n[User attached image: ${a.name}. Describe what you want done with this image.]`);
      } else if (a.textContent) {
        parts.push(`\n\n--- File: ${a.name} ---\n${a.textContent.slice(0, 6000)}`);
      }
    });

    return parts.filter(Boolean).join('').trim();
  }

  async function sendMessage() {
    const input = $('chat-input');
    // If mic is still live, kill it so late STT can't refill the box.
    if (voiceSession) stopVoiceForSend();
    const text = input.value.trim();
    const attachments = [...pendingAttachments];
    if ((!text && !attachments.length) || isSending) return;

    if (!user) {
      try {
        await loadUser();
      } catch (err) {
        showToast('Please sign in again.');
        return;
      }
    }

    isSending = true;
    updateSendState();
    input.value = '';
    pendingAttachments = [];
    renderAttachPreview();
    autoResize(input);

    let loadingEl = null;
    let streamWrap = null;
    let streamBody = null;

    try {
      const displayText = text || (attachments.some((a) => a.type === 'image') ? 'Attached image' : 'Attached file');
      const chat = ensureChat(displayText);
      chat.messages.push({ role: 'user', content: displayText, attachments });
      appendMessage('user', displayText, true, attachments);

      const history = chat.messages
        .slice(0, -1)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-12)
        .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 6000) }));

      loadingEl = document.createElement('div');
      loadingEl.className = 'msg assistant';
      loadingEl.innerHTML = `
        <div class="msg-avatar">W</div>
        <div class="msg-body"><div class="msg-loading"><span class="msg-spin"></span> Thinking…</div></div>`;
      $('chat-messages').appendChild(loadingEl);
      $('chat-messages').scrollTop = $('chat-messages').scrollHeight;

      const model = $('model-select')?.value || '';
      const length = selectedLength || 'medium';
      const extra = PROMPTS[length] || PROMPTS.medium;
      const image = attachments.find((a) => a.type === 'image')?.dataUrl || '';

      let streamed = '';
      const ensureStreamBubble = () => {
        if (streamWrap) return;
        loadingEl?.remove();
        loadingEl = null;
        streamWrap = document.createElement('div');
        streamWrap.className = 'msg assistant is-streaming';
        streamWrap.innerHTML = `
          <div class="msg-avatar">W</div>
          <div class="msg-body"></div>`;
        streamBody = streamWrap.querySelector('.msg-body');
        $('chat-messages').appendChild(streamWrap);
      };

      const { ok, data } = await WriteAIApi.apiStream('/action/stream', {
        action: 'chat',
        text: buildApiText(text, attachments),
        extra,
        model,
        length,
        history,
        source: 'web',
        ...(image ? { image } : {})
      }, {
        onDelta: (delta) => {
          ensureStreamBubble();
          streamed += delta;
          streamBody.innerHTML = formatContent(streamed, 'assistant');
          $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
        }
      });

      loadingEl?.remove();
      loadingEl = null;

      if (!ok) {
        streamWrap?.remove();
        if (
          data.error === 'monthly_limit_reached'
          || data.error === 'daily_limit_reached'
          || data.error === 'free_limit_reached'
          || data.error === 'free_token_limit_reached'
          || data.error === 'pro_feature'
        ) {
          appendUpgradePrompt(data.message || 'You\'ve reached your plan limit this month.');
        } else if (data.error === 'model_not_allowed') {
          appendUpgradePrompt(data.message || 'That model is available on Pro.');
        } else if (data.error === 'rate_limit_exceeded' || data.error === 'concurrency_limit_reached') {
          appendMessage('assistant', `⚠️ ${data.message || 'Too many requests. Please wait a moment.'}`);
        } else {
          const errMsg = data.message || 'Something went wrong. Please try again.';
          appendMessage('assistant', `⚠️ ${errMsg}`);
        }
        return;
      }

      const finalText = data.result || streamed;
      if (streamWrap && streamBody) {
        streamWrap.classList.remove('is-streaming');
        streamBody.innerHTML = formatContent(finalText, 'assistant');
      } else {
        appendMessage('assistant', finalText);
      }

      chat.messages.push({ role: 'assistant', content: finalText });
      chat.updatedAt = Date.now();
      saveChats();

      await refreshUsageAfterAction(data);
    } catch (err) {
      console.error(err);
      loadingEl?.remove();
      streamWrap?.remove();
      showToast('Could not send message. Please try again.');
    } finally {
      isSending = false;
      updateSendState();
    }
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function toggleAccountMenu() {
    const wrap = $('account-menu-wrap');
    const menu = $('account-menu');
    const btn = $('account-btn');
    const open = menu.hidden;
    menu.hidden = !open;
    wrap.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeAccountMenu() {
    const wrap = $('account-menu-wrap');
    const menu = $('account-menu');
    const btn = $('account-btn');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    wrap?.classList.remove('is-open');
    btn?.setAttribute('aria-expanded', 'false');
  }

  function signOut() {
    WriteAIApi.setToken('');
    WriteAIApi.signOutExtension();
    location.href = '/login';
  }

  function syncPasswordBox() {
    if (!$('password-box') || !user) return;
    const hasPassword = !!user.has_password;
    const googleOnly = !!user.has_google && !hasPassword;
    const title = $('password-box-title');
    const note = $('password-box-note');
    const currentWrap = $('current-password-wrap');
    const saveBtn = $('save-password-btn');
    const newLabel = $('new-password-label');

    if (title) title.textContent = hasPassword ? 'Change password' : 'Create a password';
    if (newLabel) newLabel.textContent = hasPassword ? 'New password' : 'Password';
    if (currentWrap) currentWrap.classList.toggle('hidden', !hasPassword);
    if (saveBtn) saveBtn.textContent = hasPassword ? 'Update password' : 'Create password';

    if (note) {
      if (googleOnly) {
        note.textContent =
          'You signed up with Google. Creating an email and password means next time you should sign in with email and password — Google will no longer be your primary sign-in method (it stays linked as a backup).';
      } else if (hasPassword && user.has_google) {
        note.textContent =
          'Your primary sign-in is email and password. Google remains linked as a backup.';
      } else if (hasPassword) {
        note.textContent = 'Use a strong password you don’t reuse elsewhere.';
      } else {
        note.textContent = 'Add a password so you can sign in with email.';
      }
    }
  }

  function setPasswordMsg(text, kind) {
    const el = $('password-msg');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'password-msg';
      return;
    }
    el.hidden = false;
    el.textContent = text;
    el.className = `password-msg ${kind === 'ok' ? 'is-ok' : 'is-error'}`;
  }

  async function savePassword() {
    const newPassword = $('new-password')?.value || '';
    const confirm = $('confirm-password')?.value || '';
    const currentPassword = $('current-password')?.value || '';
    const btn = $('save-password-btn');

    setPasswordMsg('');
    if (newPassword.length < 8) {
      setPasswordMsg('Password must be at least 8 characters.', 'error');
      return;
    }
    if (newPassword !== confirm) {
      setPasswordMsg('Passwords do not match.', 'error');
      return;
    }
    if (user?.has_password && !currentPassword) {
      setPasswordMsg('Enter your current password.', 'error');
      return;
    }

    if (btn) btn.disabled = true;
    try {
      const body = { newPassword };
      if (user?.has_password) body.currentPassword = currentPassword;
      const { ok, data } = await WriteAIApi.apiFetch('/auth/password', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (!ok) {
        setPasswordMsg(data.message || 'Could not save password.', 'error');
        return;
      }
      user = {
        ...user,
        has_password: data.has_password ?? true,
        has_google: data.has_google ?? user.has_google,
        auth_provider: data.auth_provider || 'password',
        sign_in_method: data.sign_in_method
          || (data.has_google ? 'Email & password (Google linked)' : 'Email & password')
      };
      if ($('new-password')) $('new-password').value = '';
      if ($('confirm-password')) $('confirm-password').value = '';
      if ($('current-password')) $('current-password').value = '';
      syncPasswordBox();
      if ($('settings-signin-method')) {
        $('settings-signin-method').textContent = user.sign_in_method;
      }
      setPasswordMsg(data.message || 'Password saved.', 'ok');
    } catch {
      setPasswordMsg('Network error. Please try again.', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function sendVoiceWrite(transcript) {
    if (!transcript || isSending) return;

    // Hard-stop mic UI + session before anything else.
    voiceSendOnEnd = false;
    try { voiceSession?.abort(); } catch { /* ignore */ }
    voiceSession = null;
    voiceTranscript = '';
    clearVoiceUi();

    if (!user) {
      try {
        await loadUser();
      } catch {
        showToast('Please sign in again.');
        return;
      }
    }

    isSending = true;
    updateSendState();

    const input = $('chat-input');
    if (input) {
      input.value = '';
      autoResize(input);
    }
    updateSendState();

    let loadingEl = null;
    let streamWrap = null;
    let streamBody = null;

    try {
      const displayText = `🎤 ${transcript}`;
      const chat = ensureChat(transcript.slice(0, 40));
      chat.messages.push({ role: 'user', content: displayText });
      appendMessage('user', displayText, true);

      const history = chat.messages
        .slice(0, -1)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-12)
        .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 6000) }));

      loadingEl = document.createElement('div');
      loadingEl.className = 'msg assistant';
      loadingEl.innerHTML = `
        <div class="msg-avatar">W</div>
        <div class="msg-body"><div class="msg-loading"><span class="msg-spin"></span> Writing from your voice…</div></div>`;
      $('chat-messages').appendChild(loadingEl);
      $('chat-messages').scrollTop = $('chat-messages').scrollHeight;

      const model = $('model-select')?.value || '';
      const length = selectedLength || 'medium';
      const extra = [
        PROMPTS[length] || PROMPTS.medium,
        'This message was spoken (voice dictation). Clean up speech-to-text issues, then help as a writing assistant.',
        'If the thought is unfinished, turn it into a useful ready-to-use draft (or 2 short alternatives) instead of a clipped half-sentence.'
      ].join(' ');

      let streamed = '';
      const ensureStreamBubble = () => {
        if (streamWrap) return;
        loadingEl?.remove();
        loadingEl = null;
        streamWrap = document.createElement('div');
        streamWrap.className = 'msg assistant is-streaming';
        streamWrap.innerHTML = `
          <div class="msg-avatar">W</div>
          <div class="msg-body"></div>`;
        streamBody = streamWrap.querySelector('.msg-body');
        $('chat-messages').appendChild(streamWrap);
      };

      // Use chat so length + history behave like normal app chat (broader than polish-only).
      const { ok, data } = await WriteAIApi.apiStream('/action/stream', {
        action: 'chat',
        text: transcript,
        extra,
        model,
        length,
        history,
        source: 'web'
      }, {
        onDelta(chunk) {
          streamed += chunk;
          ensureStreamBubble();
          if (streamBody) streamBody.innerHTML = formatContent(streamed, 'assistant');
          $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
        }
      });

      loadingEl?.remove();
      if (!ok) {
        streamWrap?.remove();
        showToast(data?.message || 'Could not process voice draft.');
        return;
      }

      const result = (data?.result || streamed || '').trim();
      ensureStreamBubble();
      if (streamWrap) streamWrap.classList.remove('is-streaming');
      if (streamBody) streamBody.innerHTML = formatContent(result, 'assistant');
      chat.messages.push({ role: 'assistant', content: result });
      chat.updatedAt = Date.now();
      saveChats();
      renderHistory();
      await refreshUsageAfterAction(data || {});
    } catch {
      loadingEl?.remove();
      showToast('Network error. Please try again.');
    } finally {
      isSending = false;
      updateSendState();
    }
  }

  function bindVoiceButton() {
    const btn = $('voice-btn');
    if (!btn) return;

    if (!window.WriteAIVoice?.isSupported?.()) {
      btn.title = 'Voice dictation not supported in this browser';
      btn.disabled = true;
      return;
    }

    btn.addEventListener('click', () => {
      if (isSending) return;

      // Second click: stop listening and send polished/chat reply.
      if (voiceSession?.listening) {
        voiceSendOnEnd = true;
        try { voiceSession.stop(); } catch { /* ignore */ }
        return;
      }

      const input = $('chat-input');
      voiceTranscript = '';
      voiceSendOnEnd = true;
      voiceSession = window.WriteAIVoice.createSession({
        onStart() {
          btn.classList.add('is-listening');
          btn.setAttribute('aria-pressed', 'true');
          showToast('Listening… tap mic again to stop.');
        },
        onResult(text) {
          if (!voiceSession || isSending || !voiceSendOnEnd) return;
          voiceTranscript = text || '';
          if (input) {
            input.value = voiceTranscript;
            autoResize(input);
            updateSendState();
          }
        },
        onError(code) {
          voiceSession = null;
          voiceSendOnEnd = false;
          clearVoiceUi();
          showToast(code === 'not-allowed'
            ? 'Microphone blocked. Allow mic access and try again.'
            : 'Could not capture voice.');
        },
        onEnd(finalText) {
          const shouldSend = voiceSendOnEnd;
          voiceSession = null;
          clearVoiceUi();
          voiceSendOnEnd = false;
          if (!shouldSend || isSending) return;
          const transcript = (finalText || voiceTranscript || input?.value || '').trim();
          voiceTranscript = '';
          if (input) {
            input.value = '';
            autoResize(input);
            updateSendState();
          }
          if (transcript) sendVoiceWrite(transcript);
          else showToast('No speech captured.');
        }
      });
      voiceSession.start();
    });
  }

  async function saveUsername() {
    const input = $('settings-username');
    const btn = $('save-username-btn');
    const msg = $('username-msg');
    if (!input) return;
    const name = input.value.trim();
    if (msg) {
      msg.hidden = true;
      msg.textContent = '';
      msg.className = 'password-msg';
    }
    if (btn) btn.disabled = true;
    try {
      const { ok, data } = await WriteAIApi.apiFetch('/user/me', {
        method: 'PATCH',
        body: JSON.stringify({ name })
      });
      if (!ok) {
        if (msg) {
          msg.hidden = false;
          msg.textContent = data.message || 'Could not save username.';
          msg.className = 'password-msg is-error';
        }
        return;
      }
      user = { ...user, name: data.name, email: data.email || user.email };
      renderUser();
      if (msg) {
        msg.hidden = false;
        msg.textContent = data.message || 'Username updated.';
        msg.className = 'password-msg is-ok';
      }
    } catch {
      if (msg) {
        msg.hidden = false;
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'password-msg is-error';
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bindPasswordToggles() {
    document.querySelectorAll('.pw-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pw-target');
        const input = id ? $(id) : null;
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.querySelector('.pw-eye')?.classList.toggle('hidden', show);
        btn.querySelector('.pw-eye-off')?.classList.toggle('hidden', !show);
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        btn.title = show ? 'Hide password' : 'Show password';
      });
    });
  }

  function bindEvents() {
    $('nav-chat').addEventListener('click', newChat);
    $('account-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAccountMenu();
    });
    $('menu-settings-btn')?.addEventListener('click', () => {
      closeAccountMenu();
      showSettings();
    });
    $('menu-logout-btn')?.addEventListener('click', signOut);
    $('sign-out-btn').addEventListener('click', signOut);
    $('save-password-btn')?.addEventListener('click', savePassword);
    $('save-username-btn')?.addEventListener('click', saveUsername);
    bindPasswordToggles();

    document.addEventListener('click', (e) => {
      const wrap = $('account-menu-wrap');
      if (wrap && !wrap.contains(e.target)) closeAccountMenu();
    });

    $('sidebar-toggle').addEventListener('click', () => {
      $('sidebar').classList.toggle('collapsed');
      closeAccountMenu();
    });

    $('theme-toggle')?.addEventListener('click', toggleTheme);

    const input = $('chat-input');
    input.addEventListener('input', () => {
      autoResize(input);
      updateSendState();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    input.addEventListener('paste', async (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find((i) => i.type.startsWith('image/'));
      if (!imageItem) return;
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) await addAttachment(file);
    });

    $('attach-btn')?.addEventListener('click', () => $('file-input')?.click());
    $('file-input')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) await addAttachment(file);
      e.target.value = '';
    });

    bindVoiceButton();

    $('send-btn').addEventListener('click', sendMessage);

    document.querySelectorAll('#length-group .tool-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) {
          showToast('Long answers are available on Pro.');
          return;
        }
        document.querySelectorAll('#length-group .tool-chip').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        selectedLength = btn.dataset.length;
      });
    });

    bindPromptCards();
  }

  async function maybeHideExtensionBanner() {
    const banner = $('extension-banner');
    if (!banner) return;
    const present = await WriteAIApi.detectExtension();
    if (present) banner.classList.add('hidden');
  }

  async function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
    // Restore route immediately (sync) so refresh never flashes the wrong view.
    renderHistory();
    if (!restoreFromRoute()) {
      showChat();
    }
    window.addEventListener('popstate', () => {
      if (!restoreFromRoute()) {
        currentChatId = null;
        newChat();
      }
    });

    const authed = await requireAuth();
    if (!authed) return;
    initModelPicker();
    bindEvents();
    maybeHideExtensionBanner();
    try {
      await loadUser();
      renderHistory();
      handleQueryParams();
    } catch (err) {
      console.error(err);
      if (user) {
        renderUser();
        renderHistory();
        showToast('Some account details failed to load. Chat may still work.');
      } else {
        showToast('Failed to load your account. Try signing in again.');
      }
    } finally {
      document.documentElement.dataset.appBoot = '0';
    }
  }

  init();
})();
