/**
 * Phase 5 verification — Stripe webhook dispatcher.
 *
 * Exercises `handleStripeEvent()` with synthesized Stripe events directly
 * (bypassing the HTTP route + signature verify). Proves:
 *   - BOOKING checkout.session.completed → booking CONFIRMED, payment written, NO commissions
 *   - MEMBERSHIP checkout.session.completed → subscription linked to user
 *   - invoice.paid → payment written, commissions distributed up the chain
 *   - duplicate events → short-circuit with reason "duplicate"
 *   - unhandled event types → recorded, returned with reason "unhandled"
 *
 * Run: npm run verify:phase5
 * Idempotent cleanup of verify-phase5-* users.
 */

import bcrypt from "bcryptjs";
import type Stripe from "stripe";
import { db } from "../src/lib/db";
import { generateUniqueReferralCode } from "../src/lib/referral";
import { handleStripeEvent } from "../src/lib/stripe-webhook";

const EMAIL_PREFIX = "verify-phase5-";
const EMAIL_DOMAIN = "@test.dbu-poc";

function rand(prefix: string) {
  return prefix + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

async function cleanup() {
  const targets = await db.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX, endsWith: EMAIL_DOMAIN } },
    select: { id: true },
  });
  const ids = targets.map((u) => u.id);
  if (ids.length === 0) return;
  await db.commission.deleteMany({
    where: { OR: [{ payerId: { in: ids } }, { beneficiaryId: { in: ids } }] },
  });
  await db.payment.deleteMany({ where: { userId: { in: ids } } });
  await db.booking.deleteMany({
    where: { OR: [{ clientId: { in: ids } }, { barberId: { in: ids } }] },
  });
  await db.service.deleteMany({ where: { barberProfileId: { in: ids } } });
  await db.barberProfile.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  // Purge webhook event rows this script created
  await db.webhookEvent.deleteMany({
    where: { stripeEventId: { startsWith: "evt_verify_phase5_" } },
  });
}

async function createUser(opts: {
  tag: string;
  name: string;
  role?: "CLIENT" | "BARBER" | "ADMIN";
  rank?: "MEMBER" | "PRO" | "ELITE" | "COACH" | "DYNASTY";
  sponsorId?: string;
}) {
  return db.user.create({
    data: {
      email: `${EMAIL_PREFIX}${opts.tag}${EMAIL_DOMAIN}`,
      passwordHash: await bcrypt.hash("test-password-123", 10),
      name: opts.name,
      referralCode: await generateUniqueReferralCode(),
      role: opts.role ?? "BARBER",
      rank: opts.rank,
      sponsorId: opts.sponsorId,
    },
    select: { id: true, email: true },
  });
}

// ─── Event builders ───────────────────────────────────────────────────────

function bookingCompletedEvent(input: {
  eventId: string;
  bookingId: string;
  paymentIntentId: string;
  amount: number;
}): Stripe.Event {
  return {
    id: input.eventId,
    object: "event",
    type: "checkout.session.completed",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: rand("cs_"),
        object: "checkout.session",
        payment_intent: input.paymentIntentId,
        amount_total: input.amount,
        payment_status: "paid",
        metadata: { productType: "BOOKING", bookingId: input.bookingId },
      } as unknown as Stripe.Checkout.Session,
    },
  } as unknown as Stripe.Event;
}

function membershipCompletedEvent(input: {
  eventId: string;
  userId: string;
  customerId: string;
  subscriptionId: string;
}): Stripe.Event {
  return {
    id: input.eventId,
    object: "event",
    type: "checkout.session.completed",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: rand("cs_"),
        object: "checkout.session",
        customer: input.customerId,
        subscription: input.subscriptionId,
        mode: "subscription",
        metadata: { productType: "MEMBERSHIP", userId: input.userId },
      } as unknown as Stripe.Checkout.Session,
    },
  } as unknown as Stripe.Event;
}

function invoicePaidEvent(input: {
  eventId: string;
  subscriptionId: string;
  paymentIntentId: string;
  amountPaid: number;
}): Stripe.Event {
  return {
    id: input.eventId,
    object: "event",
    type: "invoice.paid",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: rand("in_"),
        object: "invoice",
        subscription: input.subscriptionId,
        payment_intent: input.paymentIntentId,
        amount_paid: input.amountPaid,
      } as unknown as Stripe.Invoice,
    },
  } as unknown as Stripe.Event;
}

function unknownEvent(eventId: string): Stripe.Event {
  return {
    id: eventId,
    object: "event",
    type: "charge.succeeded", // not handled by our dispatcher
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: { object: { id: rand("ch_") } as unknown as Stripe.Charge },
  } as unknown as Stripe.Event;
}

// ─── Scenario ─────────────────────────────────────────────────────────────

async function scenario(): Promise<Array<[string, boolean]>> {
  // Build a 3-level upline for the membership payer so there's commission to distribute
  const top = await createUser({ tag: "top-coach", name: "Top Coach", rank: "COACH" });
  const mid = await createUser({ tag: "mid-pro", name: "Mid Pro", rank: "PRO", sponsorId: top.id });
  const payer = await createUser({ tag: "member-payer", name: "Member Payer", rank: "MEMBER", sponsorId: mid.id });

  // ─── Scenario A: BOOKING webhook ────────────────────────────────────────
  const client = await createUser({ tag: "client", name: "Booking Client", role: "CLIENT" });
  const barber = await createUser({ tag: "booking-barber", name: "Booking Barber", rank: "MEMBER" });

  const profile = await db.barberProfile.create({
    data: {
      userId: barber.id,
      slug: `p5-booking-${rand("").slice(0, 6)}`,
      weeklyAvailability: {},
      services: { create: [{ name: "Cut", durationMin: 30, priceCents: 4000 }] },
    },
    include: { services: true },
  });
  const service = profile.services[0];
  const booking = await db.booking.create({
    data: {
      barberId: barber.id,
      clientId: client.id,
      serviceId: service.id,
      startAt: new Date(Date.now() + 86_400_000),
      endAt: new Date(Date.now() + 86_400_000 + 30 * 60_000),
      status: "PENDING",
    },
  });

  const bookingPI = rand("pi_");
  const bookingEvent = bookingCompletedEvent({
    eventId: `evt_verify_phase5_booking_${rand("").slice(0, 8)}`,
    bookingId: booking.id,
    paymentIntentId: bookingPI,
    amount: service.priceCents,
  });
  const bookingResult = await handleStripeEvent(bookingEvent);
  const bookingAfter = await db.booking.findUnique({ where: { id: booking.id } });
  const bookingPayment = await db.payment.findUnique({ where: { stripePaymentIntentId: bookingPI } });
  const bookingCommissions = bookingPayment
    ? await db.commission.count({ where: { sourcePaymentId: bookingPayment.id } })
    : -1;

  // Idempotency: re-deliver same event
  const bookingDupe = await handleStripeEvent(bookingEvent);

  // ─── Scenario B: MEMBERSHIP checkout.session.completed ─────────────────
  const customerId = rand("cus_");
  const subscriptionId = rand("sub_");
  const membershipEvent = membershipCompletedEvent({
    eventId: `evt_verify_phase5_member_${rand("").slice(0, 8)}`,
    userId: payer.id,
    customerId,
    subscriptionId,
  });
  const membershipResult = await handleStripeEvent(membershipEvent);
  const payerAfter = await db.user.findUnique({
    where: { id: payer.id },
    select: { stripeCustomerId: true, stripeSubscriptionId: true },
  });

  // ─── Scenario C: invoice.paid → commission distribution ────────────────
  const invoicePI = rand("pi_");
  const invoiceEvent = invoicePaidEvent({
    eventId: `evt_verify_phase5_invoice_${rand("").slice(0, 8)}`,
    subscriptionId,
    paymentIntentId: invoicePI,
    amountPaid: 2900,
  });
  const invoiceResult = await handleStripeEvent(invoiceEvent);
  const invoicePayment = await db.payment.findUnique({ where: { stripePaymentIntentId: invoicePI } });
  const invoiceCommissions = invoicePayment
    ? await db.commission.findMany({
        where: { sourcePaymentId: invoicePayment.id },
        orderBy: { level: "asc" },
      })
    : [];

  // Idempotent re-deliver
  const invoiceDupe = await handleStripeEvent(invoiceEvent);

  // ─── Scenario D: unknown event type ─────────────────────────────────────
  const unknownId = `evt_verify_phase5_unknown_${rand("").slice(0, 8)}`;
  const unknownResult = await handleStripeEvent(unknownEvent(unknownId));
  const unknownRecorded = await db.webhookEvent.findUnique({ where: { stripeEventId: unknownId } });

  // ─── Assertions ─────────────────────────────────────────────────────────
  const commissionBeneficiaries = new Set(invoiceCommissions.map((c) => c.beneficiaryId));

  return [
    // Scenario A
    [
      "A: booking event returns processed=true",
      bookingResult.processed === true && bookingResult.type === "checkout.session.completed",
    ],
    ["A: booking flipped to CONFIRMED", bookingAfter?.status === "CONFIRMED"],
    ["A: booking payment row written", !!bookingPayment && bookingPayment.productType === "BOOKING"],
    ["A: booking triggered ZERO commissions (client has no upline)", bookingCommissions === 0],
    [
      "A: duplicate booking event returns reason=duplicate",
      bookingDupe.processed === false && "reason" in bookingDupe && bookingDupe.reason === "duplicate",
    ],
    // Scenario B
    [
      "B: membership event returns processed=true",
      membershipResult.processed === true,
    ],
    ["B: stripeCustomerId written on payer", payerAfter?.stripeCustomerId === customerId],
    ["B: stripeSubscriptionId written on payer", payerAfter?.stripeSubscriptionId === subscriptionId],
    // Scenario C
    [
      "C: invoice event returns processed=true",
      invoiceResult.processed === true,
    ],
    ["C: MEMBERSHIP payment written for invoice", !!invoicePayment && invoicePayment.productType === "MEMBERSHIP"],
    ["C: commissions distributed up payer's 2-step upline", invoiceCommissions.length === 2],
    ["C: mid earned L1", commissionBeneficiaries.has(mid.id) && invoiceCommissions.find((c) => c.beneficiaryId === mid.id)?.level === 1],
    ["C: top earned L2", commissionBeneficiaries.has(top.id) && invoiceCommissions.find((c) => c.beneficiaryId === top.id)?.level === 2],
    [
      "C: duplicate invoice event returns reason=duplicate",
      invoiceDupe.processed === false && "reason" in invoiceDupe && invoiceDupe.reason === "duplicate",
    ],
    // Scenario D
    [
      "D: unknown event type returns processed=false with reason=unhandled",
      unknownResult.processed === false && "reason" in unknownResult && unknownResult.reason === "unhandled",
    ],
    ["D: unknown event still recorded (so retries short-circuit)", !!unknownRecorded],
  ];
}

async function main() {
  console.log("→ Cleaning up previous verification users (FK-ordered)...");
  await cleanup();

  console.log("\n→ Scenarios: BOOKING + MEMBERSHIP + invoice.paid + duplicate + unknown...");
  const assertions = await scenario();

  let failed = 0;
  console.log("\nAssertions:");
  for (const [label, ok] of assertions) {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`\n❌ ${failed} / ${assertions.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log(`\n✓ Phase 5 verified (${assertions.length}/${assertions.length}).`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
