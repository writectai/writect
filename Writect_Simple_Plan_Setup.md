# Writect – Simple Free & Pro Plan Setup

Use this as the basic launch setup. Keep the customer side simple. The backend should control usage automatically.

---

## Start With Only 2 Plans: FREE + PRO

### 1. What Customers See

| | FREE | PRO – MOST POPULAR |
|---|---|---|
| **Price** | $0 / month | $9.99 / month |
| **AI Actions** | 10 per day / 300 per month max | High usage limits / 3,000/month max |
| **AI Models** | Fast AI models | All available AI models |
| **Writing** | Basic writing & rewriting | Advanced writing & rewriting |
| **Replies** | Short / medium replies | Longer replies |
| **Apps** | Chrome Extension + Web App | Chrome Extension + Web App |
| **Page Assistant** | Limited | Full |
| **Selection Tools** | — | Full |
| **Billing** | — | Cancel anytime |

> **If you want to charge only $7/month:** Use 2,000 actions/month for Pro instead of 3,000. If the price is $9.99/month, use 3,000.

---

### 2. What Is 1 AI Action?

| User Does This | Count |
|---|---|
| Fix grammar | 1 action |
| Rewrite text | 1 action |
| Change tone | 1 action |
| Short email / reply | 1 action |
| Long writing | 2 actions |
| Page Assistant | 3 actions |
| Very large webpage / request | 5 actions |

> **Important:** Do not count a large Page Assistant request the same as a small grammar fix.

---

### 3. Backend Limits – Developer Setup

| Setting | FREE | PRO |
|---|---|---|
| Daily actions | 10 | 150 max/day |
| Monthly actions | 300 | 3,000 |
| Normal input limit | 2,000 tokens | 4,000 tokens |
| Normal reply limit | 600 tokens | 1,200 tokens |
| Page Assistant input | Small / limited | Up to 12,000 tokens |
| Requests per minute | 5 | 15 |
| AI requests at same time | 1 | 2 |

> **Simple meaning of tokens:** Tokens are only for the backend. Do not show token limits on the pricing page. The developer uses token limits to stop very long or expensive AI requests.

---

### 4. Free Models

| Model | Access |
|---|---|
| GPT-4o mini | Free + Pro |
| Gemini 3.5 Flash Lite | Free + Pro |
| Gemini Flash Lite (latest alias) | Free + Pro |

---

### 5. Very Important Backend Tracking

| Track This | Why |
|---|---|
| Actions used today | Apply daily limit |
| Actions used this month | Apply monthly limit |
| Input tokens | Know how much text user sends |
| Output tokens | Know how much AI generates |
| AI model used | Know which model costs money |
| Estimated API cost | Know profit per user |

---

### 6. What to Write on Pricing Page

| FREE | PRO |
|---|---|
| 10 AI actions/day | High AI usage limits |
| Fast AI models | All AI models |
| Basic writing & rewriting | Advanced writing & rewriting |
| Short & medium replies | Longer AI responses |
| Chrome Extension + Web App | Full Page Assistant |
| Limited Page Assistant | Selection tools |
| | Cancel anytime |

**Do NOT write these on the pricing page:**

- ❌ Token budget / Higher token budget / Unlimited AI
- ✅ Use instead: AI actions / Fast AI models / High AI usage limits

---

### 7. Final Setup – Keep It This Simple

| | |
|---|---|
| **FREE** | $0 – 10/day – 300/month |
| **PRO** | $9.99 – 3,000/month – max 150/day |
| **If PRO is $7** | 2,000/month |
| **Large requests** | Use 2, 3, or 5 actions |
| **Customer sees** | Actions, not tokens |
| **Developer tracks** | Actions + tokens + API cost |
