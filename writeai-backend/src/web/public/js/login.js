(function () {
  const apiBase = window.WRITEAI_API_BASE || '';
  const $ = (id) => document.getElementById(id);

  const signinForm = $('signin-form');
  const signupForm = $('signup-form');
  const forgotForm = $('forgot-form');
  const errEl = $('login-error');
  const okEl = $('login-success');

  function showError(msg) {
    okEl.classList.remove('show');
    okEl.textContent = '';
    if (!msg) {
      errEl.classList.remove('show');
      errEl.textContent = '';
      return;
    }
    errEl.textContent = msg;
    errEl.classList.add('show');
  }

  function showSuccess(msg) {
    errEl.classList.remove('show');
    errEl.textContent = '';
    okEl.textContent = msg || '';
    okEl.classList.toggle('show', !!msg);
  }

  function setMode(mode) {
    showError('');
    showSuccess('');
    signinForm.classList.toggle('hidden', mode !== 'signin');
    signupForm.classList.toggle('hidden', mode !== 'signup');
    forgotForm.classList.toggle('hidden', mode !== 'forgot');
    if (mode === 'signup') {
      $('auth-title').textContent = 'Create your account';
      $('auth-sub').textContent = 'Sign up with email and password, or continue with Google.';
    } else if (mode === 'forgot') {
      $('auth-title').textContent = 'Reset password';
      $('auth-sub').textContent = 'We’ll help you get back into your account.';
    } else {
      $('auth-title').textContent = 'Welcome back';
      $('auth-sub').textContent = 'Sign in with Google or your email and password.';
    }
  }

  async function finishAuth(token) {
    WriteAIApi.setToken(token);
    WriteAIApi.pushTokenToExtension(token);
    location.href = '/app';
  }

  async function postAuth(path, body) {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  $('google-btn').addEventListener('click', () => {
    location.href = `${apiBase}/auth/google?redirect=app`;
  });

  $('show-signup').addEventListener('click', () => setMode('signup'));
  $('show-signin').addEventListener('click', () => setMode('signin'));
  $('show-forgot').addEventListener('click', () => setMode('forgot'));
  $('forgot-back').addEventListener('click', () => setMode('signin'));

  signinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const btn = $('signin-submit');
    btn.disabled = true;
    try {
      const { ok, data } = await postAuth('/auth/login', {
        email: $('signin-email').value.trim(),
        password: $('signin-password').value
      });
      if (!ok) {
        showError(data.message || 'Sign in failed.');
        return;
      }
      await finishAuth(data.token);
    } catch {
      showError('Network error. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });

  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const btn = $('signup-submit');
    btn.disabled = true;
    try {
      const { ok, data } = await postAuth('/auth/signup', {
        name: $('signup-name').value.trim(),
        email: $('signup-email').value.trim(),
        password: $('signup-password').value
      });
      if (!ok) {
        showError(data.message || 'Could not create account.');
        return;
      }
      await finishAuth(data.token);
    } catch {
      showError('Network error. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    showSuccess('');
    const btn = $('forgot-submit');
    btn.disabled = true;
    try {
      const { ok, data } = await postAuth('/auth/forgot-password', {
        email: $('forgot-email').value.trim()
      });
      if (!ok) {
        showError(data.message || 'Could not start reset.');
        return;
      }
      let msg = data.message || 'If that email exists, reset instructions are ready.';
      if (data.resetUrl) {
        msg += ` Dev reset link: ${data.resetUrl}`;
      }
      showSuccess(msg);
    } catch {
      showError('Network error. Please try again.');
    } finally {
      btn.disabled = false;
    }
  });

  const params = new URLSearchParams(location.search);
  const err = params.get('error');
  if (err) {
    showError(err === 'auth_failed' ? 'Google sign in failed. Please try again.' : 'Something went wrong.');
  }
  if (params.get('mode') === 'signup') setMode('signup');

  (async function () {
    if (!WriteAIApi.getToken()) {
      await WriteAIApi.syncFromExtension();
    }
    if (WriteAIApi.getToken()) {
      location.href = '/app';
    }
  })();
})();
