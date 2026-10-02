# Gatekeep Shop

**A Telegram storefront, ready to sell.**

Deploy it, set a few environment variables, add products, start selling.
No code editing required.

Built by **swiss9** · support: **swiss9.dev@gmail.com**

---

## What you get

- Telegram Mini App storefront (React + Vite)
- Fastify server (Bun or Node 22.5+)
- Supabase backend — database, auth, image storage
- Admin dashboard: products, orders, categories, banner, team, settings
- Two admin roles: superadmin (owner) and admin (staff)
- One-time invite links to add admins via Telegram
- Full schema with Row Level Security
- **Six payment methods** — see below
- Deploy guide for Render + Vercel

---

## Payment methods

Out of the box, Gatekeep Shop supports six ways for buyers to pay.
Everything is configured from **Admin → Settings → Payments**.

| Method | Who confirms | Money goes to |
|---|---|---|
| **Telegram Stars** | Automatic (Telegram webhook) | Your Telegram wallet (withdraw as TON) |
| **Card (Stripe)** | Automatic (Stripe webhook) | Your Stripe account |
| **Bank transfer** | You, manually | Your bank account |
| **Crypto** | You, manually | Your wallet addresses |
| **Cash on Delivery** | You, manually | Cash on hand |
| **Arrange with seller** | You, manually | Whatever you agree on |

Every method except Stars and Stripe needs **one tap** from you when the
money lands: open **Admin → Orders**, find the order, tap **Confirm paid**.
The buyer gets a Telegram message the moment you do.

### Telegram Stars

Buyers pay inside Telegram with Stars. No setup beyond enabling it in
Admin → Settings → Payments. Set the conversion rate (`Stars per $1`) to
match the current exchange. Stars can be withdrawn as TON via BotFather.

**Note:** Telegram restricts Stars to digital goods in most jurisdictions.
For physical goods, prefer Stripe or bank transfer.

### Card (Stripe)

Real per-order Stripe Checkout Sessions. The buyer is redirected to a
Stripe-hosted page sized to their exact cart total. On success, Stripe
sends a webhook and the order is marked Paid automatically.

**Setup:**

1. Create a [Stripe account](https://stripe.com) and get your secret key
   from Developers → API keys.
2. Set `STRIPE_SECRET_KEY` on your server (Render → Environment).
3. In Stripe → Developers → Webhooks → Add endpoint:
   - **URL:** `https://your-service.onrender.com/api/payments/stripe/webhook`
   - **Events:** `checkout.session.completed` and `checkout.session.expired`
4. Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
5. In Admin → Settings → Store, set **Currency code** to match your
   Stripe account (e.g. `usd`, `eur`, `gbp`).
6. Enable Stripe in Admin → Settings → Payments.

### Bank transfer / Crypto / Cash on Delivery / Arrange with seller

Fill in the details once in Admin → Settings → Payments. Buyers see them
on the confirmation screen with copy buttons. They upload a receipt or
enter a tx hash, and you confirm paid from Admin → Orders.

The receipt upload goes to a private Supabase bucket — only the buyer and
your admins can view it.

### What's NOT included

No generic "custom URL" provider. Every payment flow needs its own
confirmation contract, and a generic redirect leaves the order stuck in
Pending forever. If you want a provider we don't ship, use the Stripe
webhook route as a template — it's ~100 lines.

---

## Setup

### 1. Supabase

Create a project at [supabase.com](https://supabase.com). In the SQL
Editor, run these in order:

1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_admin_hierarchy.sql`
3. `supabase/migrations/003_grants.sql`
4. `supabase/migrations/004_payments_and_digital.sql`
5. `supabase/migrations/005_real_payments.sql`
6. `supabase/seed.sql` (optional — 6 demo products)

Copy four values from **Project Settings → API**:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` (from the JWT Settings tab)

### 2. Telegram bot

Message [@BotFather](https://t.me/BotFather), send `/newbot`, follow the
prompts. Save the token and the bot username (without `@`).

Then message [@userinfobot](https://t.me/userinfobot). Save the numeric
`Id` — that's your `ADMIN_TELEGRAM_ID`.

### 3. Deploy the server (Render)

Push the repo to GitHub. On [render.com](https://render.com):

- New Web Service → connect the repo
- Root directory: `server`
- Build: `bun install`
- Start: `bun src/index.ts`

Add these environment variables:

PORT=8080
NODE_ENV=production
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_JWT_SECRET=...
TELEGRAM_BOT_TOKEN=...
ADMIN_TELEGRAM_ID=...
TELEGRAM_BOT_USERNAME=YourBotUsername
CLIENT_ORIGIN=https://your-store.vercel.app
MINI_APP_URL=https://your-store.vercel.app
**Optional, for Stripe:**
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...


Deploy. Copy the Render URL.

### 4. Deploy the client (Vercel)

On [vercel.com](https://vercel.com), import the same repo:

- Root directory: `client`
- Framework: Vite

Environment variables:
VITE_API_URL=https://your-service.onrender.com
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_BOT_USERNAME=YourBotUsername


Deploy. Copy the Vercel URL.

### 5. Close the loop

Back on Render, update `CLIENT_ORIGIN` and `MINI_APP_URL` to the Vercel
URL. Redeploy.

### 6. Register the Mini App

In [@BotFather](https://t.me/BotFather):

- `/newapp` → pick the bot → set the Web App URL to your Vercel URL
- Bot Settings → Menu Button → same URL

Both must point at the same URL. Without `/newapp`, invite links fail.

### 7. Stripe webhook (skip if not using Stripe)

Already covered above. Do this after the server is live.

### 8. First open

Open the bot, tap the menu button. You'll land in the storefront with an
Admin tab. Add a product, set up your payment methods, buy something
yourself, confirm the payment.

---

## Customizing

Everything is done from **Admin** — no code changes.

| What | Where |
|---|---|
| Store name, tagline, currency | Admin → Settings |
| Free shipping threshold | Admin → Settings |
| Payment methods | Admin → Settings |
| Home banner | Admin → Settings |
| Perks (3 product-page bullets) | Admin → Settings |
| Categories | Admin → Categories |
| Products, images, stock | Admin → Products |
| Order status | Admin → Orders |
| Confirm paid | Admin → Orders (Pending payment tab) |
| Admins and invites | Admin → Team |

---

## Team and roles

Two roles:

- **superadmin** — owner. Full control, cannot be removed.
- **admin** — staff. Manage products, orders, settings. Cannot remove
  other admins.

**Add an admin:** Team → Invite admin. A one-time link is copied. It
expires in 48 hours and can be revoked.

**Transfer ownership:** Team → Transfer. You are demoted, they become
superadmin. Then update `ADMIN_TELEGRAM_ID` on the server and redeploy.

---

## Extending payments

The Stripe webhook at `server/src/routes/payments.ts` is a working
template for any processor that signs its webhooks. To add a new
provider:

1. Add its enable flag and any config fields to `store_settings`.
2. Add a case to `buildPaymentPayload` in `routes/orders.ts` that
   returns instructions for the buyer.
3. Add a webhook route that verifies the signature and calls
   `markPaidByOrderCode`.
4. Add a section to Admin → Settings.

The buyer-facing side (Checkout + OrderConfirmation) already handles
instructions and proof submission for manual methods — you only need
the auto-confirm path.

---

## Troubleshooting

**"Open this app from inside Telegram."**
You opened the Mini App in a browser tab. Open the bot instead.

**"initData: invalid hash"**
`TELEGRAM_BOT_TOKEN` doesn't match the bot that opened the app.

**CORS error**
`CLIENT_ORIGIN` on the server doesn't match the Vercel URL exactly.

**Admin tab missing**
Your Telegram ID isn't in `ADMIN_TELEGRAM_ID` and you haven't been
invited.

**Invite link doesn't promote**
`/newapp` isn't configured in BotFather.

**"Stripe is not configured on the server"**
`STRIPE_SECRET_KEY` is missing or wrong. Set it and restart the server.

**Stripe payments work but the order stays Pending**
The webhook isn't reaching your server. Check Stripe → Developers →
Webhooks → your endpoint → recent deliveries. Every event should show
a 200 response. If they time out, your Render service may be sleeping.

**Stars payment deducted but order still Pending**
`getUpdates` on the bot may be swallowed by another webhook. Make sure
no other process is polling the same bot token.

**"Stock changed during checkout"**
Another buyer got the last unit between your cart load and submission.
Refresh and retry.

**Receipt upload fails**
Confirm the `receipts` bucket exists (migration 005) and is set to
**private**. Check Supabase → Storage → receipts.

**Missing environment variables on boot**
Every var in `server/src/env.ts` is required unless marked optional.
Check the Render logs.

---

## Runtime notes

- **Server:** Bun recommended. Node 22.5+ works.
- **Client:** any Node 20+.
- **No file system, no cron, no queues.** All state lives in Supabase.

---

## License

Commercial single-use. See `LICENSE`.

Support: **swiss9.dev@gmail.com**
