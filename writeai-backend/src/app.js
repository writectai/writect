const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const authRoutes = require('./routes/auth');
const actionRoutes = require('./routes/action');
const billingRoutes = require('./routes/billing');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const { rateLimit } = require('./middleware/rateLimit');
const { saveUninstallFeedback } = require('./services/uninstallFeedback');

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  originAgentCluster: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(morgan('dev'));

const allowedOrigins = [
  config.frontendUrl,
  config.extensionOrigin,
  `http://localhost:${config.port}`,
  `http://127.0.0.1:${config.port}`
].filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  if (normalized.startsWith('chrome-extension://')) {
    return true;
  }
  if (allowedOrigins.some((o) => o && o.replace(/\/$/, '') === normalized)) {
    return true;
  }
  if (config.frontendUrl) {
    try {
      return new URL(origin).host === new URL(config.frontendUrl).host;
    } catch {
      return false;
    }
  }
  return false;
}

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use('/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use('/admin', express.static(path.join(__dirname, 'admin', 'public')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'public', 'index.html'));
});

app.use('/auth', authRoutes);
app.use('/action', actionRoutes);
app.use('/billing', billingRoutes);
app.use('/user', userRoutes);
app.use('/admin/api', adminRoutes);

/** Simple in-memory throttle when Redis is unavailable (uninstall form spam). */
const uninstallHits = new Map();
function allowUninstallFeedback(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const row = uninstallHits.get(key) || { n: 0, t: now };
  if (now - row.t > 60_000) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  uninstallHits.set(key, row);
  if (uninstallHits.size > 5000) {
    for (const [k, v] of uninstallHits) {
      if (now - v.t > 120_000) uninstallHits.delete(k);
    }
  }
  return row.n <= 10;
}

app.post(
  '/api/feedback/uninstall',
  rateLimit({ windowMs: 60_000, max: 10, keyPrefix: 'uninstall_fb' }),
  async (req, res) => {
    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || '';
      if (!allowUninstallFeedback(String(ip))) {
        return res.status(429).json({
          error: 'rate_limit_exceeded',
          message: 'Too many requests. Please try again later.'
        });
      }

      const row = await saveUninstallFeedback({
        reason: req.body?.reason,
        notes: req.body?.notes,
        source: req.body?.source || 'extension_uninstall',
        userAgent: req.headers['user-agent'] || '',
        ipAddress: Array.isArray(ip) ? ip[0] : String(ip).split(',')[0].trim()
      });

      res.json({ ok: true, id: row.id });
    } catch (err) {
      console.error('[uninstall feedback] save failed:', err.message || err);
      // Still acknowledge so the user sees the thank-you screen.
      res.json({ ok: true, stored: false });
    }
  }
);

const webRoot = resolveWebRoot();

function resolveWebRoot() {
  const candidates = [
    path.resolve(__dirname, 'web', 'public'),
    path.resolve(__dirname, '..', 'web', 'public'),
    path.resolve(process.cwd(), 'src', 'web', 'public'),
    path.resolve(process.cwd(), 'web', 'public'),
    path.resolve(__dirname, '..', 'public_html'),
    path.resolve(process.cwd(), 'public_html')
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      console.log(`Writect web root: ${dir}`);
      return dir;
    }
  }

  console.error('Writect web root NOT FOUND. Tried:', candidates);
  return candidates[0];
}

function sendWebPage(res, file) {
  const filePath = path.join(webRoot, file);

  if (!fs.existsSync(filePath)) {
    console.error(`Web page missing: ${filePath} (webRoot=${webRoot})`);
    return res.status(404).type('html').send(
      '<!doctype html><html><head><meta charset="utf-8"><title>Writect</title></head>'
      + '<body style="font-family:sans-serif;padding:40px"><h1>Page not found</h1>'
      + '<p>Frontend files are missing on the server. Redeploy the latest Node.js zip.</p></body></html>'
    );
  }

  try {
    let html = fs.readFileSync(filePath, 'utf8');
    // Bust CDN/browser cache after deploys
    // Bump default when shipping HTML/JS/CSS so browsers drop stale assets
    const v = process.env.ASSET_VERSION || '20260924b';
    html = html
      .replace(/(href|src)="(\/(?:css|js)\/[^"]+)"/g, `$1="$2?v=${v}"`)
      .replace('<head>', '<head>\n  <base href="/">');
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).type('html').send(html);
  } catch (err) {
    console.error(`Failed reading ${filePath}:`, err.message);
    res.status(500).type('html').send(
      '<!doctype html><title>Writect</title><p>Could not load page.</p>'
    );
  }
}

app.get('/login', (req, res) => {
  sendWebPage(res, 'login.html');
});

app.get('/login/', (req, res) => {
  sendWebPage(res, 'login.html');
});

app.get(['/reset-password', '/reset-password/'], (req, res) => {
  sendWebPage(res, 'reset-password.html');
});

app.get(['/uninstall', '/uninstall/'], (req, res) => {
  sendWebPage(res, 'uninstall.html');
});

app.get(['/app', '/app/'], (req, res) => {
  sendWebPage(res, 'app.html');
});

app.get(/^\/app\/.+/, (req, res) => {
  sendWebPage(res, 'app.html');
});

app.get(['/privacy', '/privacy/'], (req, res) => {
  sendWebPage(res, 'privacy.html');
});

app.get(['/terms', '/terms/'], (req, res) => {
  sendWebPage(res, 'terms.html');
});

app.get(['/cookies', '/cookies/'], (req, res) => {
  sendWebPage(res, 'cookies.html');
});

app.get(['/contact', '/contact/', '/support', '/support/'], (req, res) => {
  sendWebPage(res, 'contact.html');
});

app.get('/', (req, res) => {
  sendWebPage(res, 'index.html');
});

// Short cache + revalidate — long max-age caused stale landing.js redirects after deploy
const staticOpts = { maxAge: '5m', etag: true, lastModified: true, fallthrough: false };
app.use('/css', express.static(path.join(webRoot, 'css'), staticOpts));
app.use('/js', express.static(path.join(webRoot, 'js'), staticOpts));
app.use(express.static(webRoot, { fallthrough: true }));

app.get('/health', (req, res) => res.json({ status: 'ok', webRoot }));

app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'cors_error', message: 'Origin not allowed' });
  }
  // Don't turn missing static pages into JSON 500 for browsers
  if (err.status === 404 || err.code === 'ENOENT' || err.name === 'NotFoundError') {
    return res.status(404).type('html').send('<!doctype html><title>Not found</title><p>Not found</p>');
  }
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong' });
});

module.exports = app;
