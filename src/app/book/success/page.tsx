import Link from "next/link";
import { format } from "date-fns";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export default async function BookingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  if (!session_id) redirect("/");

  const checkout = await stripe.checkout.sessions.retrieve(session_id);
  if (!checkout.metadata?.bookingId) {
    return <Failed reason="Missing booking reference on Stripe session" />;
  }
  const bookingId = checkout.metadata.bookingId;

  const paymentIntentId =
    typeof checkout.payment_intent === "string"
      ? checkout.payment_intent
      : checkout.payment_intent?.id ?? null;

  if (checkout.payment_status !== "paid") {
    return <Failed reason={`Payment status: ${checkout.payment_status ?? "unknown"}`} bookingId={bookingId} />;
  }

  // Idempotent: flip booking to CONFIRMED and record Payment once.
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { service: true, barber: { select: { name: true } } },
  });
  if (!booking) return <Failed reason="Booking not found" />;

  if (booking.status !== "CONFIRMED" && paymentIntentId) {
    await db.$transaction(async (tx) => {
      // Only create Payment if we haven't seen this PI before
      const existingPayment = await tx.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });
      if (!existingPayment) {
        await tx.payment.create({
          data: {
            stripePaymentIntentId: paymentIntentId,
            userId: booking.clientId,
            amountCents: checkout.amount_total ?? booking.service.priceCents,
            productType: "BOOKING",
            status: "SUCCEEDED",
          },
        });
      }
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: "CONFIRMED",
          stripePaymentIntentId: paymentIntentId,
        },
      });
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="text-4xl mb-2">✓</div>
        <h1 className="text-xl font-semibold mb-1">Booking confirmed</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          {booking.service.name} with {booking.barber.name}
          <br />
          <span className="font-mono">{format(booking.startAt, "EEE, MMM d · h:mm a")}</span>
        </p>
        <Link
          href="/"
          className="inline-block text-sm underline text-zinc-600 dark:text-zinc-400"
        >
          Back home
        </Link>
      </div>
    </main>
  );
}

function Failed({ reason, bookingId }: { reason: string; bookingId?: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center rounded-lg border border-red-200 dark:border-red-900 p-6">
        <h1 className="text-xl font-semibold mb-1">Something went wrong</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">{reason}</p>
        {bookingId && (
          <p className="text-xs text-zinc-500 font-mono mb-4">booking: {bookingId}</p>
        )}
        <Link
          href="/"
          className="inline-block text-sm underline text-zinc-600 dark:text-zinc-400"
        >
          Back home
        </Link>
      </div>
    </main>
  );
}
