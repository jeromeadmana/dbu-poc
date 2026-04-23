import { stripe } from "./stripe";

const MEMBERSHIP_PRODUCT_META = { dbu: "membership" } as const;
const MEMBERSHIP_MONTHLY_CENTS = 2900; // $29/month — placeholder POC pricing

let cachedPriceId: string | null = null;

/**
 * Returns the Stripe Price ID for the DBU Membership subscription.
 * Preference order:
 *   1. env `STRIPE_MEMBERSHIP_PRICE_ID`
 *   2. in-process cache
 *   3. find an existing Product with metadata.dbu = "membership" and its active price
 *   4. create Product + Price on the fly (first-run bootstrap)
 */
export async function ensureMembershipPriceId(): Promise<string> {
  if (process.env.STRIPE_MEMBERSHIP_PRICE_ID) {
    return process.env.STRIPE_MEMBERSHIP_PRICE_ID;
  }
  if (cachedPriceId) return cachedPriceId;

  // Find an existing membership product by metadata
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find((p) => p.metadata?.dbu === MEMBERSHIP_PRODUCT_META.dbu);

  if (!product) {
    product = await stripe.products.create({
      name: "DBU Membership",
      metadata: { ...MEMBERSHIP_PRODUCT_META },
    });
  }

  // Find an active recurring price on that product
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
  const recurring = prices.data.find((p) => p.recurring?.interval === "month");
  if (recurring) {
    cachedPriceId = recurring.id;
    return recurring.id;
  }

  const created = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: MEMBERSHIP_MONTHLY_CENTS,
    recurring: { interval: "month" },
  });
  cachedPriceId = created.id;
  return created.id;
}

export async function createMembershipCheckoutSession(input: {
  userId: string;
  userEmail: string;
}): Promise<string> {
  const priceId = await ensureMembershipPriceId();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: input.userEmail,
    metadata: {
      userId: input.userId,
      productType: "MEMBERSHIP",
    },
    subscription_data: {
      metadata: {
        userId: input.userId,
        productType: "MEMBERSHIP",
      },
    },
    success_url: `${appUrl}/barber?membership=active`,
    cancel_url: `${appUrl}/barber?membership=cancelled`,
  });

  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return session.url;
}
