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
- Deploy guide for Render + Vercel

## What's not included

**Payments.** The checkout creates the order and returns an `order_code`.
You plug in your own payment provider after purchase — Stripe, TON,
USDC, whatever you use. The hook point is documented in section 6.

**Multi-item cart.** v1 checkout handles one product at a time.
Multi-item is a v2 roadmap item.

---

## Setup

### 1. Supabase

Create a project at [supabase.com](https://supabase.com). In the SQL
Editor, run these in order:

1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_admin_hierarchy.sql`
3. `supabase/seed.sql` (optional — gives you 6 demo products)

Copy four values from **Project Settings → API**:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET` (from the JWT Settings tab)

### 2. Telegram bot

Message [@BotFather](https://t.me/BotFather), send `/newbot`, follow
the prompts. Save the token and the bot username (without `@`).

Then message [@userinfobot](https://t.me/userinfobot). Save the
numeric `Id` — that's your `ADMIN_TELEGRAM_ID`.

### 3. Deploy the server (Render)

Push the repo to GitHub. On [render.com](https://render.com):

- New Web Service → connect the repo
- Root directory: `server`
- Build: `bun install` (or `npm install`)
- Start: `bun src/index.ts` (or `npm run start:node`)
- Environment variables — copy from `server/.env.example` and fill in:
VITE_API_URL=https://your-service.onrender.com
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_BOT_USERNAME=YourBotUsername


Deploy. Copy the Vercel URL.

### 5. Close the loop

Back on Render, update `CLIENT_ORIGIN` to your real Vercel URL and
redeploy the server. This locks CORS to your client.

### 6. Register the Mini App

In [@BotFather](https://t.me/BotFather):

- `/newapp` → pick the bot → set the Web App URL to your Vercel URL
- Bot Settings → Menu Button → same URL

Both must point at the same URL. Without this, invite links fail.

### 7. First open

Open the bot in Telegram, tap the menu button. You'll land in the
storefront. The Admin tab is visible because your Telegram ID matches
`ADMIN_TELEGRAM_ID`. Add a product, buy it yourself, check Admin →
Orders.

If that works, you're live.

---

## Customizing

Everything is done from **Admin** — no code changes.

| What | Where |
|---|---|
| Store name, tagline, currency | Admin → Settings |
| Free shipping threshold | Admin → Settings |
| Home banner (text, color, on/off) | Admin → Settings |
| Categories | Admin → Categories |
| Products, images, stock | Admin → Products |
| Order status | Admin → Orders |
| Admins and invites | Admin → Team |

---

## Team and roles

Two roles:

- **superadmin** — the owner. Full control, cannot be removed by anyone.
- **admin** — staff. Can manage products, orders, settings. Cannot
remove other admins.

**Add an admin:** Team → Invite admin. A one-time link is copied.
Send it. It expires in 48 hours and can be revoked.

**Transfer ownership:** Team → Transfer on the target. You get demoted,
they become superadmin. Then update `ADMIN_TELEGRAM_ID` on the server
to their Telegram ID and redeploy. The env var always wins.

---

## Adding payments

The order is created by `POST /api/orders` and returned to the client
with `order_code`, `total`, and `status: 'Processing'`. That's where
you hook in.

**Typical flow:**

1. Client calls `POST /api/orders` and receives the order.
2. Client redirects to your payment provider with `order_code` and `total`.
3. Provider sends a webhook back to your server.
4. Server flips `orders.status` to something like `'Paid'`.

The Admin → Orders tab already supports status changes, so you can
verify everything manually before building the webhook.

---

## Troubleshooting

**"Open this app from inside Telegram."**
You opened it in a browser tab. Open the bot in Telegram.

**"initData: invalid hash"**
`TELEGRAM_BOT_TOKEN` doesn't match the bot that opened the Mini App.

**CORS error**
`CLIENT_ORIGIN` on the server doesn't match the deployed Vercel URL
exactly (scheme + host, no trailing slash).

**Admin tab missing**
Your Telegram ID isn't in `ADMIN_TELEGRAM_ID`, or you haven't been
invited.

**Invite link doesn't promote**
`/newapp` isn't configured in BotFather. The invite format requires the
Main Mini App to be registered, not just the Menu Button.

**"Stock changed during checkout"**
Another buyer got the last unit between your cart load and your
submission. Refresh and retry.

**"Missing environment variables" on boot**
One of the required vars is empty. Check the Render logs.

---

## Runtime notes

- **Server:** Bun recommended. Node 22.5+ works (uses
`--experimental-strip-types`). Node 20 and older will not run.
- **Client:** any Node 20+ for building.
- **No file system, no cron, no queues.** All state lives in Supabase.

---

## License

Commercial single-use. See `LICENSE`. One license = one storefront.

Support: **swiss9.dev@gmail.com**
