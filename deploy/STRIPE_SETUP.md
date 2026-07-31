# Stripe setup for WriteAI (Hostinger)

## 1. Stripe Dashboard

1. Create account at https://dashboard.stripe.com
2. Switch to **Test mode** first (then Live when ready)
3. **Products** → Add product:
   - Name: `WriteAI Pro`
   - Pricing: **Recurring** → **$7.00 / month**
4. Copy the **Price ID** (`price_...`) → `STRIPE_PRO_PRICE_ID`

## 2. API keys

Developers → API keys:
- Secret key `sk_test_...` or `sk_live_...` → `STRIPE_SECRET_KEY`

## 3. Webhook (required for Pro after payment)

Developers → Webhooks → Add endpoint:

```
https://writeai.websrowitservices.com/billing/webhook
```

Events to send:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Copy **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

## 4. Hostinger env vars

Add in hPanel → Node.js → Environment:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
FRONTEND_URL=https://writeai.websrowitservices.com
```

Then **Restart / Redeploy** the app.

## 5. Test

1. Sign in as Free user
2. Hit free limit OR click **Upgrade to Pro**
3. Use Stripe test card: `4242 4242 4242 4242`
4. After success → `/app?upgraded=1` → plan should be **Pro**

## Customer portal

Pro users with Stripe billing can **Manage billing** (cancel / update card) via Stripe Customer Portal.
Enable it in Stripe → Settings → Billing → Customer portal.
