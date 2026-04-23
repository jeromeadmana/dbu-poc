import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/stripe-webhook";

/**
 * Stripe webhook endpoint.
 *
 * Requires STRIPE_WEBHOOK_SECRET in the environment. For local development:
 *   stripe listen --forward-to localhost:3000/api/webhooks/stripe
 * prints a whsec_... to paste into .env.local.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET not configured" },
      { status: 500 },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing Stripe-Signature header" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: `Invalid signature: ${msg}` }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json(result);
  } catch (err) {
    // Return 500 so Stripe retries. Log for visibility.
    console.error("[stripe-webhook] handler failed", event.id, event.type, err);
    return NextResponse.json(
      { error: "Handler failed", eventId: event.id, type: event.type },
      { status: 500 },
    );
  }
}
