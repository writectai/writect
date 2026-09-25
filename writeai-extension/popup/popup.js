const $ = (id) => document.getElementById(id);
const WEB_APP = 'https://writect.ai/app';

const signedOut = $('signed-out');
const signedIn = $('signed-in');
const loading = $('loading');

function showToast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('hidden', false);
  el.classList.toggle('is-error', isError);
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 3500);
}

function showState(state) {
  loading.classList.toggle('hidden', state !== 'loading');
  signedOut.classList.toggle('hidden', state !== 'signed-out');
  signedIn.classList.toggle('hidden', state !== 'signed-in');
}

function showSignedOut() {
  showState('signed-out');
}

function initialsFrom(user) {
  const src = user.name || user.email || '?';
  return src.charAt(0).toUpperCase();
}

function showSignedIn(user) {
  showState('signed-in');

  const isPro = user.plan === 'pro';
  const hasBilling = !!user.has_billing;

  const avatar = $('avatar');
  const fallback = $('avatar-fallback');
  fallback.textContent = initialsFrom(user);
  if (user.avatar_url) {
    avatar.onerror = () => {
      avatar.hidden = true;
      fallback.hidden = false;
    };
    avatar.src = user.avatar_url;
    avatar.hidden = false;
    fallback.hidden = true;
  } else {
    avatar.hidden = true;
    fallback.hidden = false;
  }

  $('display-name').textContent = user.name || user.email.split('@')[0];
  $('email').textContent = user.email;

  const badge = $('plan-badge');
  badge.textContent = isPro ? 'Pro' : 'Free';
  badge.className = `plan-badge ${isPro ? 'plan-pro' : 'plan-free'}`;

  const usagePanel = $('usage-panel');
  const proStatus = $('pro-status');
  const usage = user.usage || {};
  const count = usage.count || 0;
  const limit = usage.limit;
  const remaining = usage.remaining != null
    ? usage.remaining
    : (limit != null ? Math.max(0, limit - count) : null);
  const dailyCount = usage.daily_count || 0;
  const dailyLimit = usage.daily_limit;

  proStatus.classList.add('hidden');

  if (limit == null && dailyLimit == null) {
    usagePanel.classList.add('hidden');
    proStatus.textContent = isPro ? 'Pro account · all tools & models' : 'Free account';
    proStatus.classList.remove('hidden');
  } else {
    usagePanel.classList.remove('hidden');
    if (limit != null) {
      $('actions-used').textContent = `${count.toLocaleString()} / ${limit.toLocaleString()} used`;
      const pct = Math.min(100, Math.round((count / Math.max(limit, 1)) * 100));
      const fill = $('actions-fill');
      fill.style.width = `${pct}%`;
      fill.classList.toggle('is-warning', pct >= 80);
      $('actions-remaining').textContent = `${(remaining || 0).toLocaleString()} remaining`;
    } else {
      $('actions-used').textContent = `${count.toLocaleString()} used`;
      $('actions-fill').style.width = '0%';
      $('actions-remaining').textContent = '';
    }
    $('daily-used').textContent = dailyLimit != null
      ? `${dailyCount.toLocaleString()} / ${dailyLimit.toLocaleString()} actions`
      : `${dailyCount.toLocaleString()} actions`;
    const resetEl = $('usage-reset');
    if (usage.resets_at) {
      const d = new Date(`${usage.resets_at}T00:00:00Z`);
      resetEl.textContent = `Daily: 00:00 UTC · Monthly: ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`;
    } else {
      resetEl.textContent = 'Daily: 00:00 UTC';
    }
  }

  const billingSection = $('billing-section');
  const upgradeBtn = $('upgrade-btn');
  const manageBtn = $('manage-btn');

  if (isPro) {
    if (hasBilling) {
      billingSection.classList.remove('hidden');
      upgradeBtn.classList.add('hidden');
      manageBtn.classList.remove('hidden');
    } else {
      billingSection.classList.add('hidden');
    }
  } else {
    billingSection.classList.remove('hidden');
    upgradeBtn.classList.remove('hidden');
    manageBtn.classList.add('hidden');
  }
}

function showAnnouncement(announcement) {
  ['announcement-banner', 'announcement-banner-in'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (!announcement?.message) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.textContent = announcement.message;
    el.className = `announcement ${announcement.type || 'info'}`;
  });
}

$('sign-in-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_AUTH' });
  window.close();
});

$('email-sign-in-btn')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_LOGIN_PAGE' });
  window.close();
});

$('sign-out-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
  showSignedOut();
  showToast('Signed out');
});

$('open-app-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: WEB_APP });
  window.close();
});

$('open-sidepanel-btn')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await chrome.runtime.sendMessage({
    type: 'OPEN_SIDE_PANEL',
    tabId: tab?.id
  }).catch(() => null);
  if (!res?.ok) {
    showToast(res?.error || 'Could not open Page Assistant', true);
    return;
  }
  window.close();
});

$('upgrade-btn').addEventListener('click', async () => {
  const btn = $('upgrade-btn');
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CHECKOUT' });
    if (res?.url) {
      chrome.tabs.create({ url: res.url });
      window.close();
    } else {
      showToast(
        res?.message || 'Billing is not configured yet. Contact support.',
        true
      );
    }
  } finally {
    btn.disabled = false;
  }
});

$('manage-btn').addEventListener('click', async () => {
  const btn = $('manage-btn');
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'PORTAL' });
    if (res?.url) {
      chrome.tabs.create({ url: res.url });
      window.close();
    } else {
      showToast(
        res?.message || 'No billing account found. Your Pro plan was assigned by an admin.',
        true
      );
    }
  } finally {
    btn.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'USAGE_UPDATED' || !msg.usage) return;
  chrome.runtime.sendMessage({ type: 'GET_USER' }).then((res) => {
    if (res?.user) showSignedIn({ ...res.user, usage: msg.usage });
  }).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.usage?.newValue) return;
  chrome.runtime.sendMessage({ type: 'GET_USER' }).then((res) => {
    if (res?.user) showSignedIn({ ...res.user, usage: changes.usage.newValue });
  }).catch(() => {});
});

async function init() {
  showState('loading');

  const [annRes, userRes] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'GET_ANNOUNCEMENT' }).catch(() => ({})),
    chrome.runtime.sendMessage({ type: 'GET_USER' }).catch(() => ({}))
  ]);

  showAnnouncement(annRes?.announcement);

  if (userRes?.user) {
    showSignedIn(userRes.user);
  } else {
    showSignedOut();
  }
}

init();
