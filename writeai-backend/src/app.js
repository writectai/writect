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

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  contentSecurityPolicy: false
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
      console.log(`WriteAI web root: ${dir}`);
      return dir;
    }
  }

  console.error('WriteAI web root NOT FOUND. Tried:', candidates);
  return candidates[0];
}

function sendWebPage(res, file) {
  const filePath = path.join(webRoot, file);

  if (!fs.existsSync(filePath)) {
    console.error(`Web page missing: ${filePath} (webRoot=${webRoot})`);
    return res.status(404).type('html').send(
      '<!doctype html><html><head><meta charset="utf-8"><title>WriteAI</title></head>'
      + '<body style="font-family:sans-serif;padding:40px"><h1>Page not found</h1>'
      + '<p>Frontend files are missing on the server. Redeploy the latest Node.js zip.</p></body></html>'
    );
  }

  // Prefer reading the file ourselves — more reliable than sendFile on some hosts
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    res.status(200).type('html').send(html);
  } catch (err) {
    console.error(`Failed reading ${filePath}:`, err.message);
    res.status(500).type('html').send(
      '<!doctype html><title>WriteAI</title><p>Could not load page.</p>'
    );
  }
}

app.get('/login', (req, res) => {
  sendWebPage(res, 'login.html');
});

app.get('/login/', (req, res) => {
  sendWebPage(res, 'login.html');
});

app.get(['/app', '/app/'], (req, res) => {
  sendWebPage(res, 'app.html');
});

app.get(/^\/app\/.+/, (req, res) => {
  sendWebPage(res, 'app.html');
});

app.get('/', (req, res) => {
  sendWebPage(res, 'index.html');
});

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
