const OpenAI = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const config = require('../config');
const { getSetting } = require('./settings');

const LANG_RULE =
  'Always respond in the same language as the input text, unless the user explicitly asks for a different language.';

const SYSTEM_PROMPTS = {
  fix_grammar:
    `You are a grammar expert. Fix grammar, spelling, and punctuation only. Do not change meaning or style. Keep the full length of the input — never truncate. ${LANG_RULE} Return ONLY the corrected text as plain text — no markdown, no bullets, no quotes, no explanation.`,
  rephrase:
    `You are a professional editor. Rewrite the text with clearly different wording and sentence structure while keeping the same meaning, tone, and approximately the same length. Cover every point in the original — never cut off mid-sentence or shorten the message. Change sentence openings, word choice, and rhythm so the result is NOT a near-copy. ${LANG_RULE} Return ONLY the rephrased text as plain text — no markdown, no bullets, no quotes, no explanation.`,
  translate:
    `You are a professional translator specializing in regional language variants and dialects.
Translate the user's text to the target language or regional variant specified in Extra instruction.
Honor locale precisely when asked — for example:
- Formal / MSA Arabic (فصحى) vs UAE/Gulf, Saudi, or Egyptian Arabic
- US vs UK vs Australian English (spelling, vocabulary, and phrasing)
Keep the full meaning and length — never truncate.
Return ONLY the translated text as plain text — no markdown, no quotes, no explanation.`,
  voice_write:
    `You are Writect Voice → Writing. The user dictated speech (messy STT, fillers, false starts, or an unfinished thought are normal).
Produce a clear, useful writing draft they can send or paste.
- Fix grammar/punctuation and remove fillers ("um", "uh", "like").
- Keep their language and intent.
- If the dictation is incomplete or thin, expand it into a natural, ready-to-use draft (or 2 short alternative phrasings) rather than returning a clipped half-sentence.
- Prefer helpful, complete prose over ultra-minimal cleanup.
Return ONLY the draft as plain text — no markdown unless they clearly asked for structure, no preamble like "Here is your draft".`,
  summarize:
    `You are an expert at condensing content. Write a clear summary in 1–3 short paragraphs of natural prose. Cover the key ideas. ${LANG_RULE} Return ONLY the summary as plain paragraphs — no bullet points, no numbered lists, no markdown, no dashes used as list markers, no explanation.`,
  explain:
    `You are a teacher. Explain the text in simple, plain language. ${LANG_RULE} Return ONLY the explanation as plain paragraphs — no markdown, no bullet lists unless a short list truly helps clarity, no quotes around the whole answer.`,
  chat:
    'You are Writect, an expert writing assistant — similar in helpfulness to a strong general chat writing coach. Help users draft, edit, improve, translate, summarize, and brainstorm. Be clear, useful, and reasonably complete: prefer a solid usable answer over an overly terse one. Use markdown when it helps. Match requested tone and length (short / medium / long). Match the user\'s language unless they ask otherwise. Always finish every sentence, list, and template you start — never stop mid-sentence. When input is incomplete, make a best-effort useful draft and briefly note assumptions if needed. IMPORTANT: Use the full conversation history. When the user says "it", "that", "this", "summarize it", or similar, they mean prior messages — do not ask them to re-paste content already above.',
  page_summarize:
    `You are Writect Page Assistant. The user pasted extracted webpage text. Produce a clear, accurate summary of the page. Prefer 2–4 short paragraphs of natural prose unless Extra instruction asks for bullets or another format. Use the facts that appear in the text (including short forms like "10+ years", "UAE", brand names, industries). Do not invent facts that are not in the text. ${LANG_RULE} Return ONLY the requested output — no preamble like "Here is a summary".`,
  page_ask:
    `You are Writect Page Assistant. Answer the user's question using ONLY the webpage text provided below.
Rules:
- Scan the full webpage text for the answer, including short marketing phrases (e.g. "10+ years", "UAE", brand names, industries).
- If a fact appears anywhere in the text, answer with it. Prefer quoting or paraphrasing the exact phrase.
- Say "not on the page" ONLY when you genuinely cannot find any related wording after searching the whole text.
- Do not refuse just because a claim is brief or promotional.
Be concise and practical. ${LANG_RULE} Return ONLY the answer — no preamble.`
};

const BUILTIN_MODELS = [
  { id: 'gpt-4o-mini', provider: 'openai', label: 'gpt-4o-mini', free: true },
  { id: 'gpt-4o', provider: 'openai', label: 'gpt-4o', free: false },
  { id: 'gpt-4-turbo', provider: 'openai', label: 'gpt-4-turbo', free: false },
  { id: 'gemini-3.6-flash', provider: 'gemini', label: 'Gemini 3.6 Flash (recommended)', free: false },
  { id: 'gemini-3.5-flash', provider: 'gemini', label: 'Gemini 3.5 Flash', free: false },
  { id: 'gemini-3.5-flash-lite', provider: 'gemini', label: 'Gemini 3.5 Flash Lite', free: true },
  { id: 'gemini-flash-latest', provider: 'gemini', label: 'Gemini Flash (latest alias)', free: false },
  { id: 'gemini-flash-lite-latest', provider: 'gemini', label: 'Gemini Flash Lite (latest alias)', free: true }
];

/** Models free-tier users may select (lite / mini only). */
const FREE_MODEL_IDS = new Set(
  BUILTIN_MODELS.filter((m) => m.free).map((m) => m.id)
);

const LEGACY_GEMINI_MODEL_MAP = {
  'gemini-1.5-flash': 'gemini-3.6-flash',
  'gemini-1.5-flash-latest': 'gemini-3.6-flash',
  'gemini-1.5-flash-002': 'gemini-3.6-flash',
  'gemini-1.5-flash-8b': 'gemini-3.5-flash-lite',
  'gemini-1.5-pro': 'gemini-3.5-flash',
  'gemini-1.5-pro-latest': 'gemini-3.5-flash',
  'gemini-1.5-pro-002': 'gemini-3.5-flash',
  'gemini-2.0-flash': 'gemini-3.6-flash',
  'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-flash': 'gemini-3.6-flash',
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-pro': 'gemini-3.5-flash'
};

const GEMINI_FALLBACK_CHAIN = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest'
];

const ACTION_TEMPERATURE = {
  fix_grammar: 0.15,
  rephrase: 0.85,
  translate: 0.25,
  voice_write: 0.4,
  summarize: 0.35,
  explain: 0.45,
  chat: 0.65,
  page_summarize: 0.35,
  page_ask: 0.35,
  meaning_lock: 0.35
};

/**
 * Tuned sampling for MeaningLock stages (quality + meaning safety).
 * Extract/verify stay cold; rewrite is warm enough to polish, cool on retries.
 */
const MEANING_LOCK_GEN = {
  extract: {
    temperature: 0.1,
    top_p: 0.9,
    topK: 20,
    frequency_penalty: 0,
    presence_penalty: 0
  },
  rewrite: {
    temperature: 0.35,
    top_p: 0.92,
    topK: 40,
    frequency_penalty: 0.25,
    presence_penalty: 0.1
  },
  rewrite_retry: {
    temperature: 0.2,
    top_p: 0.85,
    topK: 30,
    frequency_penalty: 0.15,
    presence_penalty: 0.05
  },
  verify: {
    temperature: 0,
    top_p: 1,
    topK: 1,
    frequency_penalty: 0,
    presence_penalty: 0
  },
  safe: {
    temperature: 0.1,
    top_p: 0.8,
    topK: 20,
    frequency_penalty: 0,
    presence_penalty: 0
  }
};

/** MeaningLock™ — improve writing without changing what the user meant (automatic pipeline). */
const MEANING_EXTRACT_SYSTEM = `You are MeaningLock, an intention analyst for writing.
Extract every important intention, commitment, condition, number, softener, obligation, and factual claim from the user's text.
Pay special attention to: deadlines, quantities, conditions (if/until/before/after), soft vs hard language (around/about/approximately vs exactly/must/will), who must do what, what is NOT promised, and scope (which thing is meant).
Return ONLY valid JSON (no markdown) in this shape:
{"intentions":[{"id":"1","claim":"short factual claim","strength":"soft|hard|neutral","why":"why this matters if changed"}]}
Use 3–12 intentions. Prefer precise claims over vague themes. ${LANG_RULE}`;

const MEANING_REWRITE_SYSTEM = `You are MeaningLock, a world-class writing editor.
Craft the clearest, most polished version of the user's text — natural, professional, and ready to send.
Improve grammar, flow, word choice, and structure aggressively when it helps.
BUT NEVER change the author's intended meaning, commitments, conditions, numbers, softeners, or obligations.
HARD RULES:
- Preserve every listed intention exactly in force (soft stays soft; hard stays hard).
- Do not strengthen or weaken commitments.
- Do not drop conditions, timelines, quantities, or scope.
- Do not add new promises or facts.
- Keep approximately the same length and tone unless a small trim removes only fluff (never meaning).
${LANG_RULE}
Return ONLY the rewritten text as plain text — no markdown, no bullets, no quotes, no explanation.`;

const MEANING_VERIFY_SYSTEM = `You are MeaningLock, a strict meaning auditor.
Compare the ORIGINAL intentions against the REWRITE.
For each intention, decide: "ok" (fully preserved), "changed" (altered strength/scope/fact), or "missing" (dropped).
Return ONLY valid JSON (no markdown):
{"preserved":true|false,"checks":[{"id":"1","status":"ok|changed|missing","original":"...","new":"...","why":"one sentence on impact if not ok"}]}
Set preserved=true ONLY if every check is "ok". Be strict about soft vs hard language (around ≠ exactly). ${LANG_RULE}`;

/** In-memory response cache: identical action+text+extra → instant result */
const resultCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

// Bump when rewrite pipelines change so stale MeaningLock-era rephrase hits are ignored.
const CACHE_VER = 'v4';

function cacheKey(action, text, extra, model) {
  return crypto
    .createHash('sha256')
    .update(`${CACHE_VER}\n${action}\n${model || ''}\n${extra || ''}\n${text}`)
    .digest('hex');
}

function getCached(action, text, extra, model) {
  const key = cacheKey(action, text, extra, model);
  const hit = resultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(action, text, extra, model, value) {
  if (resultCache.size >= CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    resultCache.delete(oldest);
  }
  resultCache.set(cacheKey(action, text, extra, model), { at: Date.now(), value });
}

function resolveGeminiModel(modelName) {
  return LEGACY_GEMINI_MODEL_MAP[modelName] || modelName;
}

async function getModelConfig() {
  return getSetting('models');
}

async function getApiKeys() {
  const keys = await getSetting('api_keys');
  return {
    openai: keys.openai || config.openaiApiKey || '',
    gemini: keys.gemini || config.geminiApiKey || ''
  };
}

function resolveModelList(modelsConfig) {
  const custom = (modelsConfig.custom_models || []).map((m) => ({
    id: m.id,
    provider: m.provider,
    label: m.label || m.id,
    free: !!m.free
  }));
  const builtinIds = new Set(BUILTIN_MODELS.map((m) => m.id));
  const extra = custom.filter((m) => !builtinIds.has(m.id));
  return [...BUILTIN_MODELS, ...extra];
}

function isModelAllowedForPlan(modelId, plan) {
  if (!modelId) return false;
  if (plan === 'pro') return true;
  return FREE_MODEL_IDS.has(modelId);
}

function normalizeLength(length, plan) {
  const allowed = plan === 'pro'
    ? ['short', 'medium', 'long']
    : ['short', 'medium'];
  if (allowed.includes(length)) return length;
  return 'medium';
}

function resolveMaxTokens(action, plan, length, inputText = '') {
  const inputEstimate = Math.ceil(String(inputText || '').length / 4);
  const isPro = plan === 'pro';
  // Boss Simple Plan Setup — normal reply caps (backend only)
  const normalCap = isPro ? 1200 : 600;

  // Full rewrites: size to the input — do NOT floor at normalCap (that forced
  // 600–1200 tokens even for short emails and slowed rephrase badly).
  if (
    action === 'rephrase'
    || action === 'fix_grammar'
    || action === 'translate'
    || action === 'meaning_lock'
    || action === 'voice_write'
  ) {
    const needed = Math.ceil(inputEstimate * 1.35) + 64;
    const minFloor = action === 'rephrase' ? 180 : 120;
    const hardCap = isPro ? 2500 : 1200;
    return Math.min(hardCap, Math.max(minFloor, needed));
  }

  if (action === 'summarize' || action === 'explain') {
    return normalCap;
  }

  if (action === 'page_summarize') {
    return isPro ? Math.min(1400, normalCap + 200) : normalCap;
  }

  if (action === 'page_ask') {
    return normalCap;
  }

  if (action === 'chat' || action === 'voice_write') {
    if (isPro) {
      if (length === 'short') return Math.min(1000, normalCap);
      if (length === 'long') return Math.min(4096, 2800);
      return Math.min(2800, 1600);
    }
    // Free: honor short vs medium/long within the free reply budget
    if (length === 'short') return Math.min(400, normalCap);
    return normalCap;
  }

  return normalCap;
}

function pickDefaultModelForPlan(modelsConfig, plan) {
  const list = resolveModelList(modelsConfig).filter((m) => {
    if (m.provider === 'gemini') return modelsConfig.gemini_enabled;
    return modelsConfig.gpt_enabled;
  });

  if (plan === 'pro') {
    const primary = list.find((m) => m.id === modelsConfig.primary);
    if (primary) return primary.id;
    return list[0]?.id || 'gemini-3.5-flash-lite';
  }

  const freeList = list.filter((m) => FREE_MODEL_IDS.has(m.id) || m.free);
  const preferred = freeList.find((m) => m.id === 'gemini-3.5-flash-lite')
    || freeList.find((m) => m.id === 'gpt-4o-mini')
    || freeList[0];
  return preferred?.id || 'gemini-3.5-flash-lite';
}

function getProviderForModel(modelName, modelsConfig) {
  const all = resolveModelList(modelsConfig);
  const match = all.find((m) => m.id === modelName);
  if (match) return match.provider;
  if (modelName.includes('gemini')) return 'gemini';
  return 'openai';
}

/** True when rewrite is effectively unchanged (common failure mode for email prose). */
function isNearDuplicateText(a, b) {
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = Math.min(x.length, y.length);
  const longer = Math.max(x.length, y.length);
  if (longer < 24) return x === y;
  // High overlap of shared prefix/content length
  let same = 0;
  const lim = Math.min(x.length, y.length);
  for (let i = 0; i < lim; i += 1) {
    if (x[i] === y[i]) same += 1;
    else break;
  }
  if (same / longer >= 0.92) return true;
  if (shorter / longer >= 0.97 && (x.includes(y.slice(0, Math.floor(shorter * 0.85))) || y.includes(x.slice(0, Math.floor(shorter * 0.85))))) {
    return true;
  }
  return false;
}

function stripModelArtifacts(text) {
  if (!text) return text;
  let t = String(text).trim();
  // Strip wrapping quotes the model sometimes adds
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  // Avoid huge blank gaps in chat/email drafts
  t = t.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t;
}

function parseImageDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  return { mimeType: m[1], data: m[2].replace(/\s+/g, '') };
}

function buildUserText(action, text, extra = '') {
  if (action === 'page_ask' && extra) {
    // Question first so the model attends to the ask, then grounds in page text.
    return `Question:\n${extra}\n\nWebpage text (use this as the only source of facts):\n${text}`;
  }
  if (action === 'translate' && extra) {
    return `Target language / regional variant: ${extra}\n\nText to translate:\n${text}`;
  }
  if (action === 'voice_write') {
    return extra
      ? `Dictation transcript:\n${text}\n\nExtra instruction: ${extra}`
      : `Dictation transcript:\n${text}`;
  }
  return extra ? `${text}\n\nExtra instruction: ${extra}` : text;
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({
      role: m.role,
      content: String(m.content).trim().slice(0, 6000)
    }))
    .filter((m) => m.content)
    .slice(-12);
}

function toGeminiHistory(history) {
  const turns = [];
  for (const m of normalizeHistory(history)) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    if (turns.length && turns[turns.length - 1].role === role) {
      turns[turns.length - 1].parts[0].text += `\n\n${m.content}`;
    } else {
      turns.push({ role, parts: [{ text: m.content }] });
    }
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

function buildOpenAIMessages(action, text, extra, image, history = []) {
  const systemPrompt = SYSTEM_PROMPTS[action];
  const userText = buildUserText(action, text, extra);
  const parsedImage = parseImageDataUrl(image);
  const messages = [{ role: 'system', content: systemPrompt }];

  for (const m of normalizeHistory(history)) {
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }

  let userContent = userText;
  if (parsedImage) {
    userContent = [
      { type: 'text', text: userText },
      { type: 'image_url', image_url: { url: `data:${parsedImage.mimeType};base64,${parsedImage.data}` } }
    ];
  }
  messages.push({ role: 'user', content: userContent });
  return messages;
}

async function runWithGPT(action, text, extra = '', modelName = 'gpt-4o-mini', maxTokens = 800, image = '', history = []) {
  const keys = await getApiKeys();
  if (!keys.openai) throw new Error('OpenAI API key not configured');

  const openai = new OpenAI({ apiKey: keys.openai });
  const temperature = ACTION_TEMPERATURE[action] ?? 0.4;
  const messages = buildOpenAIMessages(action, text, extra, image, history);

  const response = await openai.chat.completions.create({
    model: modelName,
    messages,
    max_tokens: maxTokens,
    temperature,
    top_p: action === 'fix_grammar' ? 0.85 : 0.95,
    frequency_penalty: action === 'rephrase' ? 0.45 : 0,
    presence_penalty: action === 'chat' ? 0.15 : 0
  });

  return {
    result: stripModelArtifacts(response.choices[0].message.content),
    model: modelName,
    input_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.completion_tokens
  };
}

async function runWithGemini(action, text, extra = '', modelName = 'gemini-3.6-flash', maxTokens = 800, image = '', history = []) {
  const keys = await getApiKeys();
  if (!keys.gemini) throw new Error('Gemini API key not configured');

  const resolvedModel = resolveGeminiModel(modelName);
  const genAI = new GoogleGenerativeAI(keys.gemini);
  const temperature = ACTION_TEMPERATURE[action] ?? 0.4;
  const systemPrompt = SYSTEM_PROMPTS[action];
  const userText = buildUserText(action, text, extra);
  const parsedImage = parseImageDataUrl(image);
  const gemHistory = toGeminiHistory(history);

  const model = genAI.getGenerativeModel({
    model: resolvedModel,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: action === 'fix_grammar' ? 0.85 : 0.95,
      topK: action === 'fix_grammar' ? 20 : 40
    }
  });

  let resp;
  let promptForEstimate = userText;

  if (gemHistory.length && !parsedImage) {
    const chat = model.startChat({ history: gemHistory });
    const response = await chat.sendMessage(userText);
    resp = response.response;
  } else {
    const prompt = gemHistory.length
      ? `${gemHistory.map((t) => `${t.role === 'model' ? 'Assistant' : 'User'}: ${t.parts[0].text}`).join('\n\n')}\n\nUser: ${userText}`
      : userText;
    promptForEstimate = prompt;
    const parts = parsedImage
      ? [
        { text: prompt },
        { inlineData: { mimeType: parsedImage.mimeType, data: parsedImage.data } }
      ]
      : prompt;
    const response = await model.generateContent(parts);
    resp = response.response;
  }

  const result = stripModelArtifacts(resp.text());
  const usage = resp.usageMetadata;

  return {
    result,
    model: resolvedModel,
    input_tokens: usage?.promptTokenCount ?? estimateTokens(promptForEstimate),
    output_tokens: usage?.candidatesTokenCount ?? estimateTokens(result)
  };
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function isQuotaOrRateLimit(err) {
  return err.status === 429
    || /429|quota|rate.?limit|too many requests/i.test(err.message || '');
}

function isOverloaded(err) {
  return err.status === 503
    || /503|high demand|overloaded|unavailable|try again later|resource.?exhausted/i.test(err.message || '');
}

function isModelUnavailable(err) {
  return isQuotaOrRateLimit(err)
    || isOverloaded(err)
    || err.status === 404
    || /not found|404|is not found for api version|no longer available/i.test(err.message || '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithGeminiFallback(action, text, extra, preferredModel, maxTokens, plan = 'pro', image = '', history = []) {
  const start = resolveGeminiModel(preferredModel);
  // Keep rewrite/tool chains short — a long fallback list was causing 12–60s waits.
  const isRewrite = action === 'rephrase'
    || action === 'fix_grammar'
    || action === 'translate'
    || action === 'voice_write'
    || action === 'summarize'
    || action === 'explain';
  const preferredOrder = isRewrite
    ? [start, 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest']
    : plan === 'pro'
      ? [
        start,
        'gemini-3.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-flash-latest',
        ...GEMINI_FALLBACK_CHAIN
      ]
      : [
        start,
        'gemini-3.5-flash-lite',
        'gemini-flash-lite-latest'
      ];
  const chain = [...new Set(preferredOrder)].filter((id) => isModelAllowedForPlan(id, plan));
  let lastErr;

  for (const modelName of chain) {
    try {
      return await runWithGemini(action, text, extra, modelName, maxTokens, image, history);
    } catch (err) {
      lastErr = err;
      if (!isModelUnavailable(err)) throw err;
      // One short pause only on overload, then move on — do not burn seconds per model.
      if (isOverloaded(err)) {
        console.error(`Gemini ${modelName} overloaded (503), trying next…`);
        await sleep(200);
      } else {
        console.error(`Gemini ${modelName} unavailable (${err.status || 'error'}), trying next model...`);
      }
    }
  }

  throw lastErr;
}

/**
 * User-facing messages only — never expose Admin → AI Config / model names / billing URLs.
 * Admin details are logged server-side.
 */
function parseAiError(err) {
  const busy = 'AI is temporarily busy. Please try again in a few seconds.';
  const unavailable = 'AI is temporarily unavailable. Please try again later.';

  if (err.message === 'OpenAI API key not configured') {
    console.error('[AI config] OpenAI key missing');
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }
  if (err.message === 'Gemini API key not configured') {
    console.error('[AI config] Gemini key missing');
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }
  if (err.message === 'All AI models are disabled') {
    console.error('[AI config] All models disabled');
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }
  if (err.code === 'model_not_allowed' || /Model not available on free plan/i.test(err.message || '')) {
    return {
      status: 403,
      code: 'model_not_allowed',
      message: 'That model is available on Pro. Upgrade or pick a free-tier model.'
    };
  }

  if (isQuotaOrRateLimit(err) || isOverloaded(err)) {
    console.error('[AI busy]', err.message);
    return { status: 429, code: 'ai_quota_exceeded', message: busy };
  }

  if (err.status === 403 || /403|permission|api key not valid/i.test(err.message || '')) {
    console.error('[AI auth]', err.message);
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }

  if (err.status === 404 || /not found|404/i.test(err.message || '')) {
    console.error('[AI model]', err.message);
    return { status: 503, code: 'ai_unavailable', message: unavailable };
  }

  console.error('[AI error]', err.message || err);
  return { status: 500, code: 'ai_error', message: busy };
}

async function runWithProvider(action, text, extra, modelName, modelsConfig, maxTokens, plan, image = '', history = []) {
  const provider = getProviderForModel(modelName, modelsConfig);
  if (provider === 'gemini') {
    return runWithGeminiFallback(action, text, extra, modelName, maxTokens, plan, image, history);
  }
  return runWithGPT(action, text, extra, modelName, maxTokens, image, history);
}

function parseJsonPayload(raw) {
  let t = String(raw || '').trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

async function completeGPTRaw({ system, user, modelName, maxTokens, gen = {} }) {
  const keys = await getApiKeys();
  if (!keys.openai) throw new Error('OpenAI API key not configured');
  const openai = new OpenAI({ apiKey: keys.openai });
  const temperature = gen.temperature ?? 0.4;
  const payload = {
    model: modelName,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    max_tokens: maxTokens,
    temperature
  };
  if (gen.top_p != null) payload.top_p = gen.top_p;
  if (gen.frequency_penalty != null) payload.frequency_penalty = gen.frequency_penalty;
  if (gen.presence_penalty != null) payload.presence_penalty = gen.presence_penalty;

  const response = await openai.chat.completions.create(payload);
  return {
    result: stripModelArtifacts(response.choices[0].message.content),
    model: modelName,
    input_tokens: response.usage?.prompt_tokens || 0,
    output_tokens: response.usage?.completion_tokens || 0
  };
}

async function completeGeminiRaw({ system, user, modelName, maxTokens, gen = {} }) {
  const keys = await getApiKeys();
  if (!keys.gemini) throw new Error('Gemini API key not configured');
  const resolvedModel = resolveGeminiModel(modelName);
  const genAI = new GoogleGenerativeAI(keys.gemini);
  const generationConfig = {
    temperature: gen.temperature ?? 0.4,
    maxOutputTokens: maxTokens
  };
  if (gen.top_p != null) generationConfig.topP = gen.top_p;
  if (gen.topK != null) generationConfig.topK = gen.topK;

  const model = genAI.getGenerativeModel({
    model: resolvedModel,
    generationConfig
  });
  const prompt = `${system}\n\n${user}`;
  const response = await model.generateContent(prompt);
  const resp = response.response;
  const result = stripModelArtifacts(resp.text());
  const usage = resp.usageMetadata;
  return {
    result,
    model: resolvedModel,
    input_tokens: usage?.promptTokenCount ?? estimateTokens(prompt),
    output_tokens: usage?.candidatesTokenCount ?? estimateTokens(result)
  };
}

async function completeRaw({ system, user, modelName, modelsConfig, maxTokens, gen = {}, plan }) {
  const provider = getProviderForModel(modelName, modelsConfig);
  try {
    if (provider === 'gemini') {
      return await completeGeminiRaw({ system, user, modelName, maxTokens, gen });
    }
    return await completeGPTRaw({ system, user, modelName, maxTokens, gen });
  } catch (err) {
    if (provider === 'gemini' && modelsConfig.gpt_enabled) {
      return completeGPTRaw({
        system,
        user,
        modelName: 'gpt-4o-mini',
        maxTokens,
        gen
      });
    }
    if (provider !== 'gemini' && modelsConfig.gemini_enabled) {
      return completeGeminiRaw({
        system,
        user,
        modelName: 'gemini-3.5-flash-lite',
        maxTokens,
        gen
      });
    }
    throw err;
  }
}

function formatIntentionsList(intentions) {
  return (intentions || [])
    .map((i, idx) => {
      const id = i.id || String(idx + 1);
      const strength = i.strength || 'neutral';
      return `- [${id}] (${strength}) ${i.claim || ''}`;
    })
    .join('\n');
}

function normalizeVerify(parsed, intentions) {
  const checks = Array.isArray(parsed?.checks) ? parsed.checks : [];
  const byId = new Map(checks.map((c) => [String(c.id), c]));
  const normalized = (intentions || []).map((i, idx) => {
    const id = String(i.id || idx + 1);
    const hit = byId.get(id) || checks[idx] || {};
    const status = ['ok', 'changed', 'missing'].includes(hit.status) ? hit.status : 'changed';
    return {
      id,
      claim: i.claim || '',
      strength: i.strength || 'neutral',
      status,
      original: hit.original || i.claim || '',
      new: hit.new || '',
      why: hit.why || ''
    };
  });
  const preserved = normalized.length > 0 && normalized.every((c) => c.status === 'ok');
  return { preserved, checks: normalized };
}

/**
 * MeaningLock pipeline (no user steps):
 * 1) Extract intentions  2) Rewrite under constraints  3) Verify  4) Auto-retry if drift
 */
async function runMeaningLockPipeline(text, extra, { selectedModel, models, maxTokens, plan }) {
  let input_tokens = 0;
  let output_tokens = 0;
  let usedModel = selectedModel;

  const addUsage = (part) => {
    input_tokens += part.input_tokens || 0;
    output_tokens += part.output_tokens || 0;
    if (part.model) usedModel = part.model;
  };

  const extractUser = extra
    ? `Text:\n${text}\n\nExtra instruction (do not let this override meaning extraction of the text):\n${extra}`
    : `Text:\n${text}`;

  const extracted = await completeRaw({
    system: MEANING_EXTRACT_SYSTEM,
    user: extractUser,
    modelName: selectedModel,
    modelsConfig: models,
    maxTokens: Math.min(900, maxTokens),
    gen: MEANING_LOCK_GEN.extract,
    plan
  });
  addUsage(extracted);

  let intentions = parseJsonPayload(extracted.result)?.intentions;
  if (!Array.isArray(intentions) || intentions.length === 0) {
    // Fallback: treat whole text as one intention so rewrite still runs safely
    intentions = [{ id: '1', claim: text.slice(0, 280), strength: 'neutral', why: 'Preserve overall meaning' }];
  }
  intentions = intentions.slice(0, 12).map((i, idx) => ({
    id: String(i.id || idx + 1),
    claim: String(i.claim || '').trim(),
    strength: ['soft', 'hard', 'neutral'].includes(i.strength) ? i.strength : 'neutral',
    why: String(i.why || '').trim()
  })).filter((i) => i.claim);

  const intentBlock = formatIntentionsList(intentions);

  const buildRewriteUser = (failures = '') => {
    let u = `ORIGINAL:\n${text}\n\nINTENTIONS TO PRESERVE:\n${intentBlock}`;
    if (extra) u += `\n\nStyle note (must not change meaning):\n${extra}`;
    if (failures) {
      u += `\n\nPREVIOUS REWRITE FAILED MEANING CHECK. Fix ONLY these drifts — do not invent new meaning:\n${failures}`;
    }
    return u;
  };

  const verifyUser = (rewrite) => (
    `ORIGINAL TEXT:\n${text}\n\nINTENTIONS:\n${intentBlock}\n\nREWRITE:\n${rewrite}\n\nAudit the rewrite against every intention.`
  );

  let rewriteText = '';
  let meaning = { preserved: false, checks: [], intentions };
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const failureNotes = meaning.checks
      .filter((c) => c.status !== 'ok')
      .map((c) => `- [${c.id}] ${c.status}: ${c.claim}${c.why ? ` — ${c.why}` : ''}`)
      .join('\n');

    const rewritten = await completeRaw({
      system: MEANING_REWRITE_SYSTEM,
      user: buildRewriteUser(attempt > 1 ? failureNotes : ''),
      modelName: selectedModel,
      modelsConfig: models,
      maxTokens,
      gen: attempt === 1 ? MEANING_LOCK_GEN.rewrite : MEANING_LOCK_GEN.rewrite_retry,
      plan
    });
    addUsage(rewritten);
    rewriteText = rewritten.result;

    const verified = await completeRaw({
      system: MEANING_VERIFY_SYSTEM,
      user: verifyUser(rewriteText),
      modelName: selectedModel,
      modelsConfig: models,
      maxTokens: Math.min(900, maxTokens),
      gen: MEANING_LOCK_GEN.verify,
      plan
    });
    addUsage(verified);

    const parsed = parseJsonPayload(verified.result);
    meaning = {
      ...normalizeVerify(parsed, intentions),
      intentions
    };

    if (meaning.preserved) break;

    // Last attempt: conservative polish (grammar/clarity only) if still drifting
    if (attempt === maxAttempts && !meaning.preserved) {
      const safe = await completeRaw({
        system:
          `You are MeaningLock. The previous rewrite changed meaning. Produce a CONSERVATIVE improvement of the ORIGINAL: `
          + `fix grammar and clarity only. Do not rephrase creatively. Preserve every intention exactly. `
          + `${LANG_RULE} Return ONLY the improved text as plain text.`,
        user: buildRewriteUser(failureNotes),
        modelName: selectedModel,
        modelsConfig: models,
        maxTokens,
        gen: MEANING_LOCK_GEN.safe,
        plan
      });
      addUsage(safe);
      rewriteText = safe.result;

      const recheck = await completeRaw({
        system: MEANING_VERIFY_SYSTEM,
        user: verifyUser(rewriteText),
        modelName: selectedModel,
        modelsConfig: models,
        maxTokens: Math.min(900, maxTokens),
        gen: MEANING_LOCK_GEN.verify,
        plan
      });
      addUsage(recheck);
      meaning = {
        ...normalizeVerify(parseJsonPayload(recheck.result), intentions),
        intentions
      };
    }
  }

  return {
    result: rewriteText,
    model: usedModel,
    input_tokens,
    output_tokens,
    meaning: {
      preserved: !!meaning.preserved,
      intentions: meaning.intentions,
      checks: meaning.checks
    }
  };
}

async function runAction(action, text, extra = '', options = {}) {
  const plan = options.plan === 'pro' ? 'pro' : 'free';
  const length = normalizeLength(options.length, plan);
  const maxTokens = resolveMaxTokens(action, plan, length, text);
  const image = options.image || '';
  const history = normalizeHistory(options.history);
  const models = await getModelConfig();
  const all = resolveModelList(models);

  let selectedModel = options.model;
  if (selectedModel && !all.some((m) => m.id === selectedModel)) {
    selectedModel = '';
  }
  if (selectedModel && !isModelAllowedForPlan(selectedModel, plan)) {
    const err = new Error('Model not available on free plan');
    err.code = 'model_not_allowed';
    throw err;
  }
  if (!selectedModel) {
    selectedModel = pickDefaultModelForPlan(models, plan);
  }

  // Skip cache when an image is attached or chat has prior turns (vision / multi-turn are unique)
  if (!options.forceRefresh && !image && !history.length) {
    const cached = getCached(action, text, extra, selectedModel);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  let result;

  // MeaningLock is only for the dedicated meaning_lock action.
  // Rephrase must be a single creative rewrite — the old shared pipeline was slow
  // and often returned near-identical email prose via its "safe" fallback.
  if (action === 'meaning_lock') {
    result = await runMeaningLockPipeline(text, extra, {
      selectedModel,
      models,
      maxTokens,
      plan
    });
  } else {
    const provider = getProviderForModel(selectedModel, models);
    try {
      result = await runWithProvider(action, text, extra, selectedModel, models, maxTokens, plan, image, history);
    } catch (err) {
      if (err.code === 'model_not_allowed') throw err;

      if (provider === 'gemini' && models.gpt_enabled) {
        const fallbackId = 'gpt-4o-mini';
        console.error('Gemini failed, falling back to OpenAI:', err.message);
        result = await runWithGPT(action, text, extra, fallbackId, maxTokens, image, history);
      } else if (provider !== 'gemini' && models.gemini_enabled) {
        const fallbackId = 'gemini-3.5-flash-lite';
        console.error('GPT failed, falling back to Gemini:', err.message);
        result = await runWithGeminiFallback(action, text, extra, fallbackId, maxTokens, plan, image, history);
      } else {
        throw err;
      }
    }
    // No second rephrase pass — a near-dupe retry doubled latency (12–60s). Prompt + sampling handle variety.
  }

  // Never attach MeaningLock metadata to plain rewrite actions.
  if (action !== 'meaning_lock' && result?.meaning) {
    const { meaning: _drop, ...rest } = result;
    result = rest;
  }

  // Do not cache failed rephrases (identical output) — next click should try again.
  const skipCache = action === 'rephrase'
    && result?.result
    && isNearDuplicateText(text, result.result);

  if (!image && !history.length && !skipCache) {
    setCached(action, text, extra, selectedModel, result);
  }
  return { ...result, cached: false };
}

async function streamWithGPT(action, text, extra, modelName, maxTokens, image, history, onDelta) {
  const keys = await getApiKeys();
  if (!keys.openai) throw new Error('OpenAI API key not configured');

  const openai = new OpenAI({ apiKey: keys.openai });
  const temperature = ACTION_TEMPERATURE[action] ?? 0.4;
  const messages = buildOpenAIMessages(action, text, extra, image, history);

  const stream = await openai.chat.completions.create({
    model: modelName,
    messages,
    max_tokens: maxTokens,
    temperature,
    top_p: action === 'fix_grammar' ? 0.85 : 0.95,
    frequency_penalty: action === 'rephrase' ? 0.45 : 0,
    presence_penalty: action === 'chat' ? 0.15 : 0,
    stream: true,
    stream_options: { include_usage: true }
  });

  let full = '';
  let input_tokens = 0;
  let output_tokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (delta) {
      full += delta;
      if (typeof onDelta === 'function') onDelta(delta);
    }
    if (chunk.usage) {
      input_tokens = chunk.usage.prompt_tokens || input_tokens;
      output_tokens = chunk.usage.completion_tokens || output_tokens;
    }
  }

  const result = stripModelArtifacts(full);
  if (!input_tokens) input_tokens = estimateTokens(JSON.stringify(messages));
  if (!output_tokens) output_tokens = estimateTokens(result);

  return { result, model: modelName, input_tokens, output_tokens };
}

async function streamWithGemini(action, text, extra, modelName, maxTokens, image, history, onDelta) {
  const keys = await getApiKeys();
  if (!keys.gemini) throw new Error('Gemini API key not configured');

  const resolvedModel = resolveGeminiModel(modelName);
  const genAI = new GoogleGenerativeAI(keys.gemini);
  const temperature = ACTION_TEMPERATURE[action] ?? 0.4;
  const systemPrompt = SYSTEM_PROMPTS[action];
  const userText = buildUserText(action, text, extra);
  const parsedImage = parseImageDataUrl(image);
  const gemHistory = toGeminiHistory(history);

  const model = genAI.getGenerativeModel({
    model: resolvedModel,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: action === 'fix_grammar' ? 0.85 : 0.95,
      topK: action === 'fix_grammar' ? 20 : 40
    }
  });

  let streamResult;
  if (gemHistory.length && !parsedImage) {
    const chat = model.startChat({ history: gemHistory });
    streamResult = await chat.sendMessageStream(userText);
  } else {
    const prompt = gemHistory.length
      ? `${gemHistory.map((t) => `${t.role === 'model' ? 'Assistant' : 'User'}: ${t.parts[0].text}`).join('\n\n')}\n\nUser: ${userText}`
      : userText;
    const parts = parsedImage
      ? [
        { text: prompt },
        { inlineData: { mimeType: parsedImage.mimeType, data: parsedImage.data } }
      ]
      : prompt;
    streamResult = await model.generateContentStream(parts);
  }

  let full = '';
  for await (const chunk of streamResult.stream) {
    let delta = '';
    try {
      delta = chunk.text() || '';
    } catch {
      delta = '';
    }
    if (delta) {
      full += delta;
      if (typeof onDelta === 'function') onDelta(delta);
    }
  }

  const aggregated = await streamResult.response;
  const usage = aggregated.usageMetadata;
  const result = stripModelArtifacts(full || aggregated.text());

  return {
    result,
    model: resolvedModel,
    input_tokens: usage?.promptTokenCount ?? estimateTokens(userText),
    output_tokens: usage?.candidatesTokenCount ?? estimateTokens(result)
  };
}

/**
 * Stream chat (and similar) tokens via onDelta callbacks. Falls back across providers like runAction.
 */
async function streamAction(action, text, extra = '', options = {}, onDelta) {
  const plan = options.plan === 'pro' ? 'pro' : 'free';
  const length = normalizeLength(options.length, plan);
  const maxTokens = resolveMaxTokens(action, plan, length, text);
  const image = options.image || '';
  const history = normalizeHistory(options.history);
  const models = await getModelConfig();
  const all = resolveModelList(models);

  let selectedModel = options.model;
  if (selectedModel && !all.some((m) => m.id === selectedModel)) {
    selectedModel = '';
  }
  if (selectedModel && !isModelAllowedForPlan(selectedModel, plan)) {
    const err = new Error('Model not available on free plan');
    err.code = 'model_not_allowed';
    throw err;
  }
  if (!selectedModel) {
    selectedModel = pickDefaultModelForPlan(models, plan);
  }

  const provider = getProviderForModel(selectedModel, models);
  try {
    if (provider === 'gemini') {
      return await streamWithGemini(action, text, extra, selectedModel, maxTokens, image, history, onDelta);
    }
    return await streamWithGPT(action, text, extra, selectedModel, maxTokens, image, history, onDelta);
  } catch (err) {
    if (err.code === 'model_not_allowed') throw err;

    if (provider === 'gemini' && models.gpt_enabled) {
      console.error('Gemini stream failed, falling back to OpenAI:', err.message);
      return streamWithGPT(action, text, extra, 'gpt-4o-mini', maxTokens, image, history, onDelta);
    }
    if (provider !== 'gemini' && models.gemini_enabled) {
      console.error('GPT stream failed, falling back to Gemini:', err.message);
      return streamWithGemini(action, text, extra, 'gemini-3.5-flash-lite', maxTokens, image, history, onDelta);
    }
    throw err;
  }
}

module.exports = {
  runAction,
  streamAction,
  parseAiError,
  SYSTEM_PROMPTS,
  getModelConfig,
  getApiKeys,
  resolveModelList,
  isModelAllowedForPlan,
  normalizeLength,
  FREE_MODEL_IDS,
  BUILTIN_MODELS
};
