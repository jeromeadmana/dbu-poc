# DBU-POC

Booking + referral network + commission platform — Next.js 15 + Prisma 6 + NextAuth v5 + Stripe.

## What's in here

- **Signup with referral code** (`?ref=<CODE>`) — auto-captures sponsor, builds the network tree.
- **Booking flow** — public `/book/<barber-slug>`, service/day/slot picker, Stripe hosted Checkout, idempotent confirmation.
- **Commission engine** — recursive upline walk with **rank compression**. Member earns L1-L2, Pro L1-L3, Elite L1-L5, Coach/Dynasty L1-L7. Unique-constraint-backed idempotency.
- **Membership subscription** — $29/mo recurring; each `invoice.paid` webhook fires commission distribution.
- **Webhooks** — `/api/webhooks/stripe` with signature verification, idempotent event processing, handles checkout + invoice + subscription-deleted.
- **Barber dashboard** — today / upcoming bookings, services, capacity meter with conditional course unlock at 90%.
- **Courses** — `/courses` with unlock rules (always | rank_gte | capacity_gte), `/courses/<id>` Loom embed + completion tracking.
- **Admin panel** — `/admin` gated to ADMIN role; stats, inline user rank/role edit, commission log with release button, webhook event log.

## Stack

| | |
|---|---|
| Framework | Next.js **15.5** (App Router) |
| Language | TypeScript strict |
| Auth | Auth.js v5 (NextAuth 5 beta), credentials + JWT sessions |
| DB | MySQL via Prisma **6** on Aiven (shared — all tables `dbu_` prefixed) |
| Payments | Stripe (test mode), hosted Checkout flow |
| Styling | Tailwind v4 + shadcn-style primitives |
| Hosting | Vercel (Hobby — no crons; manual admin actions instead) |

## Getting started (local dev)

### 1. Prereqs

- Node 20+ (tested on 24)
- Aiven MySQL service (free tier works)
- Stripe account (test mode is fine)
- The Aiven CA certificate dropped in `./cert/ca.pem` (gitignored; see [cert/README.md](cert/README.md))

### 2. Install

```bash
npm install
```

### 3. Environment

Copy `.env.example` → `.env.local` and fill in:

```
DATABASE_URL="mysql://USER:PASS@HOST.aivencloud.com:PORT/DB?sslaccept=strict&sslcert=./cert/ca.pem"
AUTH_SECRET="..."               # openssl rand -base64 32
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..." # from `stripe listen` (local) or dashboard (prod)
NEXT_PUBLIC_APP_URL="http://localhost:3000"
COMMISSION_HOLD_DAYS="14"
```

### 4. Apply the schema

The shared Aiven DB has **other projects' tables alongside ours** — `prisma db push` would drop them. **Never** run `db push`.

Use the diff-based apply instead:

```bash
npm run db:diff:init > prisma/migrations/00_init.sql   # or whatever name
# Review the SQL — confirm every CREATE / ALTER references dbu_*
npm run db:apply -- prisma/migrations/00_init.sql
```

For subsequent schema changes use `npm run db:diff:incremental` the same way.

### 5. Seed

```bash
npm run seed:courses       # 3 course modules with different unlock rules
npm run seed:demo          # full demo — 6 users, network tree, bookings, 1 membership payment
```

### 6. Run

```bash
npm run dev                # http://localhost:3000
```

In another terminal, forward Stripe webhooks to your local server:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Paste the printed whsec_... into .env.local as STRIPE_WEBHOOK_SECRET
```

## Demo accounts

After `npm run seed:demo`, all of these sign in with password **`demo1234`**:

| Email | Role | What to try |
|---|---|---|
| `demo-admin@dbu-poc.test` | ADMIN | `/admin` — stats, release commissions, edit ranks |
| `demo-dynasty@dbu-poc.test` | BARBER (DYNASTY) | Receives L3 commissions from Matt's payment |
| `demo-elite@dbu-poc.test` | BARBER (ELITE) | Receives L2 commissions |
| `demo-pro@dbu-poc.test` | BARBER (PRO) | Receives L1 commissions |
| `demo-member@dbu-poc.test` | BARBER (MEMBER) | Has services + 3 confirmed bookings; `/barber` dashboard is most populated here |
| `demo-client1@dbu-poc.test` | CLIENT | Booked 3 appointments with Matt |

### Demo flow

1. Sign in as `demo-member@dbu-poc.test` → `/barber` dashboard shows services, upcoming bookings, capacity meter.
2. Grab Matt's booking link (`/book/matt-member-...`) → open in incognito.
3. In incognito: click **Book** → redirected to signup carrying Matt's referral code + callback back to the booking page. Sign up.
4. Pick a service + slot → Stripe Checkout → pay with test card `4242 4242 4242 4242` (any future date, any CVC).
5. Back on Matt's dashboard → the new booking appears under **Upcoming**.
6. Sign in as `demo-admin@dbu-poc.test` → `/admin` → see commission rows from Matt's seeded membership payment.

## Deploying to Vercel

Same `.env.example` variables go in Vercel Settings → Environment Variables, with two adjustments:

- **`DATABASE_URL`** — drop the `sslcert=./cert/ca.pem` parameter. The cert file isn't in the deployment bundle. Aiven still enforces TLS with `?ssl-mode=REQUIRED` alone.
- **`NEXT_PUBLIC_APP_URL`** — set to your Vercel deployment URL (e.g. `https://dbu-poc.vercel.app`) so Stripe `success_url` / `cancel_url` come back to the right host.

After deploy, create a webhook endpoint in the Stripe dashboard:

- URL: `https://<your-app>.vercel.app/api/webhooks/stripe`
- Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`
- Reveal signing secret → paste into Vercel as `STRIPE_WEBHOOK_SECRET` → **redeploy** (env changes need a rebuild).

Admin bootstrap on prod:

```bash
npm run make:admin <email>   # run locally; writes straight to the shared DB
# Then sign out + sign in on prod so the JWT reflects role=ADMIN
```

## Operational notes

- **No cron jobs.** Pending commissions are released via an admin button on `/admin`, not a scheduled job. By design — Vercel Hobby tier restriction.
- **Rank change requires JWT refresh.** `becomeBarberAction` calls `unstable_update()` to set a new session cookie. Any other role change (e.g., via admin panel) currently requires the affected user to sign out + in.
- **Shared DB safety.** Never `prisma db push`. Always diff + review SQL + `db execute`. See [tasks/lessons.md](tasks/lessons.md) if you have it locally — there's a specific incident log.

## Scripts

| | |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build (runs `prisma generate` first) |
| `npm run db:diff:init` | Generate SQL for a fresh schema (from empty → current) |
| `npm run db:diff:incremental` | Generate SQL for schema changes (from current DB → schema) |
| `npm run db:apply -- <file.sql>` | Apply a SQL file via Prisma |
| `npm run db:studio` | Prisma Studio against Aiven |
| `npm run seed:demo` | Full playable demo seed |
| `npm run seed:courses` | Only the 3 course modules |
| `npm run make:admin <email>` | Promote a user to ADMIN |
| `npm run verify:phase1` | Signup + sponsor chain assertions |
| `npm run verify:phase2` | Upline/downline traversal assertions |
| `npm run verify:phase3` | Slot generator + real Stripe Checkout assertions |
| `npm run verify:phase4` | Commission engine + compression (38 assertions) |
| `npm run verify:phase5` | Webhook dispatcher assertions |
| `npm run diag:bookings` | Diagnostic — recent bookings per barber |

## Project layout

```
prisma/
  schema.prisma           10 models, all @@map("dbu_<name>")
  migrations/             SQL snapshots; generated, not applied by Prisma
src/
  auth.ts                 NextAuth v5 config (uses Prisma, Node runtime)
  auth.config.ts          Edge-safe subset used by middleware
  middleware.ts           Role gates for /admin, /barber, /client
  lib/
    db.ts                 Prisma singleton
    referral.ts           Unique referral code generator (unambiguous alphabet)
    network.ts            walkUpline / walkDownline
    booking.ts            Slot generator + availability defaults + slug builder
    stripe.ts             Stripe SDK singleton
    stripe-webhook.ts     Event dispatcher + idempotency
    stripe-membership.ts  $29/mo price bootstrap + Checkout Session builder
    commission/
      rates.ts            RANK_DEPTH map + per-level basis-point table
      distribute.ts       Pure compression algorithm + DB writer
      waiver.ts           recomputeWaiverStatus (3+ referrals → isSubscriptionWaived)
      release.ts          Manual release PENDING → APPROVED
    courses.ts            Unlock rule evaluator (always / rank_gte / capacity_gte)
    barber-stats.ts       Today/week/capacity/commissions aggregate
  app/
    page.tsx              Logged-out marketing | logged-in hub
    (auth)/signup | signin
    barber/               Barber dashboard with KPI grid + capacity meter
    network/              Upline + downline tree view
    book/[slug]/          Public booking page + BookingForm (client component)
    book/success | cancel Post-Checkout landing pages
    courses/              Course list + detail with Loom embed
    admin/                Admin panel
    api/webhooks/stripe/  Stripe webhook endpoint
scripts/
  seed-demo.ts            Full demo seed
  seed-courses.ts         Course modules only
  make-admin.ts           Promote user to ADMIN
  verify-phase*.ts        End-to-end assertion scripts
  diag-bookings.ts        Recent bookings diagnostic
  repro-auth-bounce.py    Playwright repro for the JWT-refresh bug (fixed)
```
