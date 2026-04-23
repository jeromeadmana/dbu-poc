# DBU POC — Demo Walkthrough

A step-by-step guide for anyone evaluating the app. No dev setup needed — everything runs on the deployed site.

**Live URL:** https://dbu-poc.vercel.app

**Test card for all Stripe checkouts:** `4242 4242 4242 4242`, any future expiry date (e.g. `12/34`), any 3-digit CVC, any ZIP.

---

## Seeded demo accounts

These accounts are pre-seeded in the database. Password for **all** of them: `demo1234`

| Email | Role | Notes |
|---|---|---|
| `demo-admin@dbu-poc.test` | Admin | Full admin panel access |
| `demo-dynasty@dbu-poc.test` | Barber (Dynasty rank) | Top of the sponsor chain |
| `demo-elite@dbu-poc.test` | Barber (Elite rank) | Sponsored by Dynasty |
| `demo-pro@dbu-poc.test` | Barber (Pro rank) | Sponsored by Elite |
| `demo-member@dbu-poc.test` | Barber (Member rank) | Has 3 services + bookings; most populated dashboard |
| `demo-client1@dbu-poc.test` | Client | Has 3 upcoming bookings with Matt |

You can also sign up with your own email to experience the flow fresh.

---

## A · Sign up (new user)

**Takes about 1 minute.**

1. Open https://dbu-poc.vercel.app
2. Click **Sign up**
3. Fill in:
   - Name (anything — e.g. "Jane Demo")
   - Email (any valid email — it doesn't send real emails)
   - Password (minimum 8 characters)
4. Click **Create account**
5. You'll land on a dashboard showing:
   - Your name
   - Your unique **referral code** (e.g. `ABC123`)
   - A **sponsor** section (empty for now — you signed up without a code)
   - A **Barber** card with a "Become a barber" button
   - An **upcoming bookings** section (empty until you book)

> **If you had signed up via a referral link** (step E.1 below), your sponsor field would show the person who referred you, and their downline tree grows by one.

---

## B · Sign in (existing user)

1. Open https://dbu-poc.vercel.app
2. Click **Sign in**
3. Enter email + password (use one of the seeded accounts above or your own)
4. Click **Sign in** — you land on your dashboard

---

## C · Become a barber

**Who:** any logged-in user who's not already a barber.
**Takes:** 10 seconds.

1. Sign in (section B)
2. On the home dashboard, find the **Barber** card
3. Click **Become a barber**
4. The app:
   - Creates your barber profile (slug = your name + referral code, e.g. `jane-demo-abc123`)
   - Seeds 2 default services: `Haircut` ($40, 30 min) and `Haircut + Beard Trim` ($60, 45 min)
   - Sets your availability to Monday–Friday 9 AM–5 PM
   - Promotes your role to `BARBER` with rank `MEMBER`
5. You're redirected to `/barber` — your barber dashboard. You'll see:
   - Your name and rank
   - KPI cards (today, this week, upcoming, commissions — all zero at first)
   - A **capacity meter** (shows 0% of a 40-hour target)
   - Your **public booking link** with a Copy button (e.g. `https://dbu-poc.vercel.app/book/jane-demo-abc123`)
   - Your services list
   - A **Membership** card with a "Start membership" button

---

## D · Start membership subscription

**Who:** any barber.
**Takes:** ~1 minute (Stripe Checkout).

1. On `/barber`, scroll to the **Membership** card
2. Click **Start membership**
3. You're redirected to Stripe's hosted checkout page
4. Enter test card details:
   - Card: `4242 4242 4242 4242`
   - Expiry: any future date
   - CVC: any 3 digits
   - Name / ZIP: anything
5. Click **Subscribe**
6. You return to `/barber?membership=active`. The Membership card now says **Active**
7. Behind the scenes:
   - Stripe sent a webhook to our server
   - A `Payment` row was written ($29)
   - The commission engine walked your sponsor chain and distributed commissions up to 7 levels
   - Your sponsor's `isSubscriptionWaived` flag auto-flips to `true` if you're their 3rd+ active referral

> **To see the commissions that just flowed**, sign out and sign in as `demo-admin@dbu-poc.test` → `/admin` → Recent commissions section.

---

## E · Book a service (as a client)

**Who:** anyone, including people who haven't signed up yet (they'll be prompted to join mid-flow).
**Takes:** ~2 minutes including payment.

### Option 1 — Start from a barber's public link

1. Get a booking link from any barber, e.g. Matt Member's link:
   `https://dbu-poc.vercel.app/book/matt-member-<code>`
   (To find it exactly: sign in as `demo-member@dbu-poc.test`, go to `/barber`, click **Copy link**.)
2. Open the link **in an incognito / private window** (to simulate a fresh visitor)
3. You'll see Matt's profile, services, and a booking form

### Option 2 — Already signed in

Skip to step 3.

### Booking flow

1. Pick a **service** (Haircut or Haircut + Beard Trim)
2. Pick a **day** from the next 7 days (day buttons scroll horizontally)
3. Pick a **time slot** (15-min aligned; past slots are hidden)
4. Click **Book for $X.XX**
5. **If not signed in yet:** you're bounced to `/signup` with the barber's referral code pre-filled and a "return to booking" flag. Fill in signup → land back on the booking page with the same slot still selected
6. Click **Book for $X.XX** again (now that you're logged in)
7. You're redirected to Stripe Checkout
8. Pay with test card details (same as section D)
9. You land on `/book/success` with a "Booking confirmed" message
10. Behind the scenes:
    - A `PENDING` booking row was created before redirecting to Stripe
    - On return, the booking flips to `CONFIRMED` and a `Payment` row is written
    - The `/barber` page refreshes so the booking appears under **Upcoming** on the barber's dashboard
    - No commissions are distributed for bookings (commission logic only fires for membership + coaching payments by design)

---

## F · Cancel a booking

**Who:** the booking's client, the booking's barber, or any admin.
**What happens:** status flips to `CANCELLED` and the Stripe payment is refunded automatically.

### As the client

1. Sign in as the client (e.g. `demo-client1@dbu-poc.test`)
2. On the home dashboard, find the **Your upcoming bookings** section
3. Click **Cancel** next to the booking you want to end
4. Page refreshes — the booking disappears from the list
5. If the booking was paid, the Stripe test-mode refund is issued and the Payment row is marked `REFUNDED`

### As the barber

1. Sign in as the barber (e.g. `demo-member@dbu-poc.test`)
2. Go to `/barber`
3. Find the booking in **Today** or **Upcoming**
4. Click **Cancel** next to it
5. Booking disappears, refund flow same as above

> Synthetic seed bookings have fake payment IDs (`pi_seed_*`) — those skip the Stripe refund call but still mark the booking cancelled.

---

## G · View your network tree

**Who:** any logged-in user.
**Where:** `/network` (also reachable from the home dashboard via "View network tree →")

1. Sign in
2. Click **View network tree →** on the home dashboard (or open `/network` directly)
3. You'll see:
   - A **referral link** you can copy — share this with anyone
   - Your **upline** (list of sponsors up the chain, up to 7 levels)
   - Your **downline** (tree of sponsees, down to 5 levels), with role + rank badges

> **For the richest view**, sign in as `demo-dynasty@dbu-poc.test` — they're at the top, so everyone below shows up in their downline.

---

## H · Take a course

**Who:** any logged-in user. Unlock rules decide what they can actually open.
**Where:** `/courses`

1. Sign in
2. Open https://dbu-poc.vercel.app/courses (or click Courses from `/barber`)
3. You'll see three seeded modules:

| Module | Unlocks when |
|---|---|
| Getting Started with DBU | Always |
| The Pro Tier Playbook | Your rank is Pro or higher |
| Price Raise Masterclass | Your weekly booking capacity hits 90%+ |

4. Click **Open** on an unlocked module to view the Loom embed + **Mark complete** button
5. Clicking **Mark complete** toggles completion on/off (idempotent)
6. Locked modules show the exact reason (e.g. "Requires rank PRO+ (you're MEMBER)")

> **Admin users** see every module as unlocked — this is deliberate, so admins can preview all content.
> **The Loom URLs in the seeded modules are plausible-fake** — the video iframes will show Loom's "not found" page. Real content would be curated by the operator.

---

## I · Admin panel

**Who:** admins only.
**Where:** `/admin` — and the **Admin** link appears on the home dashboard when your role is ADMIN.

1. Sign in as `demo-admin@dbu-poc.test` / `demo1234`
2. Click **Admin** on the home dashboard (top right), or go to `/admin` directly
3. The admin panel has these sections:

### Stats header (4 cards)
- Total users (with role breakdown: X barbers · Y clients · Z admins)
- Total bookings count
- Payments — total SUCCEEDED + count
- Commissions — total pending + approved, with counts

### Commission release
- Shows how many commissions are eligible to release (status = PENDING and hold period has passed)
- Click **Release eligible commissions** to flip them to APPROVED
- Writes an audit log row

### Users table
For each user (up to 100 most recent):
- Name + email
- Referral code + their sponsor (with arrow)
- Flags: "first payment" (paid at least once), "waived" (3+ active referrals)
- Sponsee and commission counts
- **Inline role/rank dropdowns + Save button** — change any user's role or rank
- **Reset password** link — generates a 12-character temporary password, shown once in an amber banner at the top of the page
- **Recompute waiver** link (for barbers with sponsees) — re-checks the 3-referral threshold

> After changing a user's role or rank, **that user must sign out and back in** to see the change take effect (the JWT is cached in their browser; the dashboard note reminds you of this).

### Recent commissions (40 most recent)
- When created, payer, beneficiary, level, rank-at-payout, amount, status, release date
- Status pill: PENDING (amber) / APPROVED (green) / CANCELED (gray)

### Recent webhook events (20 most recent)
- When processed, type, Stripe event ID
- Useful to confirm Stripe is reaching the deployment

---

## J · The full money-flow demo (5-minute tour)

This is the best single sequence to showcase end-to-end mechanics.

1. Open https://dbu-poc.vercel.app in **Tab 1** — sign in as `demo-admin@dbu-poc.test`. Go to `/admin`. Keep it open.
2. Open an **incognito window** (Tab 2).
3. In Tab 2, visit `https://dbu-poc.vercel.app/book/matt-member-<code>` (find the exact URL by signing in as `demo-member` separately, copying from `/barber`)
4. Pick a service + day + slot → click **Book**
5. You're bounced to signup — fill in any new email (e.g. `demo-buyer@example.com`) + password → the referral code is pre-captured from Matt's link
6. After signup you're back on the booking page with the slot still selected → click **Book** again
7. Pay with test card `4242 4242 4242 4242`
8. You land on `/book/success` with the confirmation
9. **Flip to Tab 1 (admin panel)** and **refresh**. Notice:
   - Users count went up by 1 (your new buyer account)
   - Payments total went up by one booking (service price)
   - If you scroll to **Users table**, your new account shows Matt as their sponsor
   - **No new commissions from the booking** — because bookings don't trigger commission flow
10. Now back in Tab 2: the new buyer user → visit home dashboard → click **Become a barber** → click **Start membership** → pay with test card again
11. **Flip to Tab 1 and refresh again.** Now notice:
    - Users breakdown: one more barber
    - Payments total went up by $29 (membership)
    - **Recent commissions** section: 3 new rows — one each for Matt (L1), Pat (L2), Elena (L3) — the compression engine walked the upline
    - Webhook events: `checkout.session.completed` (subscription link) + `invoice.paid` (first invoice)

That's the full loop: signup → network join → book → barber promotion → membership → commission flow.

---

## Notes and known limitations

- **Password reset** — admin-only. A self-serve "forgot password" email flow isn't built; the demo is intended for private evaluation.
- **Reschedule a booking** — not built. Workflow is cancel + rebook. Cancellation does refund automatically.
- **Availability editor** — barbers can't currently edit their own hours; the default is Mon-Fri 9 AM-5 PM. The schema supports arbitrary schedules; the UI doesn't expose editing yet.
- **Services CRUD** — barbers can't add or remove services from the UI. Two default services are seeded; changes currently need admin or DB access.
- **Loom videos** — the three course modules have plausible-fake Loom URLs. The iframe embeds will show "not found". Operators would replace with real Loom shares.
- **SMS reminders** — intentionally out of scope for this build.
- **Stripe test mode only** — no real money moves. Test card is `4242 4242 4242 4242`; see https://docs.stripe.com/testing for other test cards.
- **Rank/role change latency** — when an admin changes someone's role or rank, the affected user sees stale access until they sign out and back in. Becoming a barber is an exception (self-initiated, refreshes session automatically).

---

## Troubleshooting

**"Sign up failed with 'Invalid input' even though I filled everything in."**
The email validator rejects TLDs containing hyphens (e.g., `.dbu-poc`). Use a standard domain like `.com`, `.test`, `.example` — or any of the seeded `@dbu-poc.test` emails.

**"I clicked Become a barber but got bounced to sign in."**
Your session cookie is stale from an older deployment. Clear site data for `dbu-poc.vercel.app` (Chrome DevTools → Application → Clear site data) or use a fresh incognito window.

**"My booking didn't appear on the barber dashboard."**
Scroll down — new bookings for *tomorrow or later* land in the **Upcoming** section (below the "Today" section, which shows "Nothing scheduled for today" if the slot isn't today).

**"The course video won't play."**
Seeded Loom URLs are fake. This is expected — real content would be swapped in by the operator.

**Any Stripe error or stuck flow?**
Admin `/admin` → Recent webhook events shows whether Stripe reached the server. If the last event was long ago, the webhook isn't connected or the deploy was redeployed without env vars.
