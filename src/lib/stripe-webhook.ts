import type Stripe from "stripe";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { distributeCommissions } from "./commission/distribute";

export type WebhookResult =
  | { processed: true; eventId: string; type: string }
  | { processed: false; reason: "duplicate"; eventId: string; type: string }
  | { processed: false; reason: "unhandled"; eventId: string; type: string };

/**
 * Dispatches a Stripe event to the right handler. Idempotent:
 *   - An event row is written to `dbu_webhook_events` on first successful processing.
 *   - A second delivery of the same event returns { reason: "duplicate" } without re-running.
 * Each downstream handler is also individually idempotent (unique keys on Payment + Commission),
 * so even if a retry slips past the check, we don't double-write.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<WebhookResult> {
  const existing = await db.webhookEvent.findUnique({
    where: { stripeEventId: event.id },
    select: { id: true },
  });
  if (existing) {
    return { processed: false, reason: "duplicate", eventId: event.id, type: event.type };
  }

  let handled = false;
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      handled = true;
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object as Stripe.Invoice);
      handled = true;
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      handled = true;
      break;
    default:
      // Unhandled event types are still recorded so we don't re-process.
      handled = false;
      break;
  }

  await db.webhookEvent.create({
    data: {
      stripeEventId: event.id,
      type: event.type,
      payload: event.data.object as unknown as Prisma.InputJsonValue,
    },
  });

  if (!handled) {
    return { processed: false, reason: "unhandled", eventId: event.id, type: event.type };
  }
  return { processed: true, eventId: event.id, type: event.type };
}

// ─── Handlers ─────────────────────────────────────────────────────────────

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const productType = session.metadata?.productType;

  if (productType === "BOOKING") {
    await handleBookingCheckout(session);
    return;
  }

  if (productType === "MEMBERSHIP") {
    await handleMembershipCheckout(session);
    return;
  }

  // No productType metadata → ignore (other integrations might use Stripe on the same account)
}

async function handleBookingCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
  if (!paymentIntentId) return;

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
      status: true,
      service: { select: { priceCents: true } },
    },
  });
  if (!booking) return;

  await db.$transaction(async (tx) => {
    const existingPayment = await tx.payment.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true },
    });
    if (!existingPayment) {
      await tx.payment.create({
        data: {
          stripePaymentIntentId: paymentIntentId,
          userId: booking.clientId,
          amountCents: session.amount_total ?? booking.service.priceCents,
          productType: "BOOKING",
          status: "SUCCEEDED",
        },
      });
    }
    if (booking.status !== "CONFIRMED") {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: "CONFIRMED", stripePaymentIntentId: paymentIntentId },
      });
    }
  });

  // Bookings don't distribute commissions (clients usually have no upline).
  // Only membership + coaching payments trigger commission flow.
}

async function handleMembershipCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId;
  if (!userId) return;

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  if (!customerId && !subscriptionId) return;

  await db.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId ?? undefined,
    },
  });

  // First-invoice payment (and any renewals) fire `invoice.paid` separately —
  // that's where Payment rows + commission distribution happen.
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  // Stripe SDK v22 dropped `subscription` and `payment_intent` from the
  // Invoice TypeScript type (they were deprecated in the Stripe API in favor
  // of per-line subscription references). The raw webhook payload, however,
  // still includes them when the Stripe account's API version predates the
  // change. Read via `unknown` cast; fall back to newer paths if available.
  const legacy = invoice as unknown as {
    subscription?: string | { id: string } | null;
    payment_intent?: string | { id: string } | null;
  };

  const lineSub = invoice.lines?.data?.[0]?.subscription;
  const subscriptionId =
    typeof legacy.subscription === "string"
      ? legacy.subscription
      : legacy.subscription?.id ??
        (typeof lineSub === "string" ? lineSub : lineSub?.id ?? null);
  if (!subscriptionId) return;

  const paymentIntentId =
    typeof legacy.payment_intent === "string"
      ? legacy.payment_intent
      : legacy.payment_intent?.id ?? null;
  if (!paymentIntentId) return;

  const user = await db.user.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { id: true },
  });
  if (!user) return;

  let payment = await db.payment.findUnique({
    where: { stripePaymentIntentId: paymentIntentId },
    select: { id: true },
  });

  if (!payment) {
    payment = await db.payment.create({
      data: {
        stripePaymentIntentId: paymentIntentId,
        userId: user.id,
        amountCents: invoice.amount_paid ?? 0,
        productType: "MEMBERSHIP",
        status: "SUCCEEDED",
      },
      select: { id: true },
    });
  }

  await distributeCommissions(payment.id);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await db.user.updateMany({
    where: { stripeSubscriptionId: subscription.id },
    data: { stripeSubscriptionId: null },
  });
}
