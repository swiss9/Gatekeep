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
