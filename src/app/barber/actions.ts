"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, unstable_update } from "@/auth";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { DEFAULT_AVAILABILITY, makeBarberSlug } from "@/lib/booking";
import { createMembershipCheckoutSession } from "@/lib/stripe-membership";

export async function becomeBarberAction() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { barberProfile: true },
  });
  if (!user) redirect("/signin");

  if (user.barberProfile) {
    redirect("/barber");
  }

  const baseSlug = makeBarberSlug(user.name, user.referralCode);
  let slug = baseSlug;
  for (let i = 2; i < 100; i++) {
    const taken = await db.barberProfile.findUnique({ where: { slug } });
    if (!taken) break;
    slug = `${baseSlug}-${i}`;
  }

  const newRank = user.rank ?? "MEMBER";

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        role: "BARBER",
        rank: newRank,
      },
    });
    await tx.barberProfile.create({
      data: {
        userId: user.id,
        slug,
        bio: null,
        weeklyAvailability: DEFAULT_AVAILABILITY,
        services: {
          create: [
            { name: "Haircut", durationMin: 30, priceCents: 4000 },
            { name: "Haircut + Beard Trim", durationMin: 45, priceCents: 6000 },
          ],
        },
      },
    });
  });

  // Refresh JWT so middleware sees the new role on next request.
  await unstable_update({ user: { role: "BARBER", rank: newRank } });

  revalidatePath("/");
  revalidatePath("/barber");
  redirect("/barber");
}

export async function startMembershipAction() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/barber");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, stripeSubscriptionId: true },
  });
  if (!user) redirect("/signin");
  if (user.stripeSubscriptionId) redirect("/barber?membership=active");

  const checkoutUrl = await createMembershipCheckoutSession({
    userId: user.id,
    userEmail: user.email,
  });
  redirect(checkoutUrl);
}

/**
 * Cancel a booking. Callable by the booking's client, the booking's barber, or any ADMIN.
 * If the booking was CONFIRMED (paid), attempt a Stripe refund — seed/synthetic
 * payment intents may not exist in Stripe, so we catch and log rather than throw.
 */
export async function cancelBookingAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const bookingId = formData.get("bookingId")?.toString();
  if (!bookingId) redirect("/?error=invalid");

  const booking = await db.booking.findUnique({
    where: { id: bookingId as string },
    select: {
      id: true,
      barberId: true,
      clientId: true,
      status: true,
      stripePaymentIntentId: true,
    },
  });
  if (!booking) redirect("/?error=not-found");

  const isBarber = booking.barberId === session.user.id;
  const isClient = booking.clientId === session.user.id;
  const isAdmin = session.user.role === "ADMIN";
  if (!isBarber && !isClient && !isAdmin) {
    redirect("/?error=forbidden");
  }

  if (!["PENDING", "CONFIRMED"].includes(booking.status)) {
    redirect(redirectBack(isBarber) + "?error=already-terminal");
  }

  const wasConfirmed = booking.status === "CONFIRMED";

  await db.booking.update({
    where: { id: booking.id },
    data: { status: "CANCELLED" },
  });

  // Attempt Stripe refund for real paid bookings. Seed data uses fake
  // payment_intent IDs (pi_seed_*) — those will fail gracefully.
  if (wasConfirmed && booking.stripePaymentIntentId && !booking.stripePaymentIntentId.startsWith("pi_seed_")) {
    try {
      await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId });
      await db.payment.updateMany({
        where: { stripePaymentIntentId: booking.stripePaymentIntentId },
        data: { status: "REFUNDED" },
      });
    } catch (err) {
      console.error("[cancelBookingAction] refund failed", booking.id, err);
      // Booking is still CANCELLED; refund can be retried manually by admin.
    }
  }

  revalidatePath("/");
  revalidatePath("/barber");
  revalidatePath("/admin");
  redirect(redirectBack(isBarber) + "?ok=cancelled");
}

function redirectBack(isBarber: boolean): string {
  return isBarber ? "/barber" : "/";
}
