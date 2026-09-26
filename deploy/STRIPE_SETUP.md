# Stripe setup for Writect (Hostinger)

## 1. Stripe Dashboard

1. Create account at https://dashboard.stripe.com
2. Switch to **Test mode** first (then Live when ready)
3. **Products** → Add product:
   - Name: `Writect Pro`
   - Pricing (monthly): **Recurring** → **$9.99 / month** → copy Price ID → `STRIPE_PRO_PRICE_ID`
   - Pricing (yearly): add another price on the same product → **Recurring** → **$99.99 / year** → copy Price ID → `STRIPE_PRO_YEARLY_PRICE_ID`
4. Copy each **Price ID** (`price_...`) into the matching env var

## 2. API keys

Developers → API keys:
- Secret key `sk_test_...` or `sk_live_...` → `STRIPE_SECRET_KEY`

## 3. Customer Portal (required for Manage billing)

Stripe Dashboard → **Settings** → **Billing** → **Customer portal**:

1. Turn the portal **On**
2. Enable: payment method update, invoice history, cancel subscription
3. Save

Writect also auto-creates a portal configuration via API if none exists. If Manage billing still fails, complete this Dashboard step and retry.

## 4. Webhook (required for Pro after payment)

Developers → Webhooks → Add endpoint:

```
https://writect.ai/billing/webhook
```

Events to send:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`

Copy **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`

## 5. Hostinger env vars

Add in hPanel → Node.js → Environment:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_PRO_YEARLY_PRICE_ID=price_...
FRONTEND_URL=https://writect.ai
```

Then **Restart / Redeploy** the app.

## 6. Test

1. Sign in as Free user
2. On the landing Pricing section, switch **Monthly / Yearly**, then **Get started**
3. Or in the web app → Settings → pick Monthly or Yearly → Upgrade
4. Use Stripe test card: `4242 4242 4242 4242`
5. After success → `/app?upgraded=1` → plan should be **Pro**

## Customer portal

Pro users with Stripe billing can **Manage billing** (cancel / update card) via Stripe Customer Portal.
See **§3 Customer Portal** above — it must be enabled or Manage billing will fail.
