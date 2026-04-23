"use server";

import { z } from "zod";
import { addMinutes } from "date-fns";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { dayBoundsUtc, generateSlots, type WeeklyAvailability } from "@/lib/booking";

type ActionResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; redirectTo?: string; error?: string };

const bookingInputSchema = z.object({
  slug: z.string().min(1),
  serviceId: z.string().min(1),
  startIso: z.string().min(1),
});

export async function getAvailableSlotsAction(
  slug: string,
  serviceId: string,
  dayIso: string,
): Promise<string[]> {
  const profile = await db.barberProfile.findUnique({
    where: { slug },
    include: { services: { where: { id: serviceId, isActive: true } } },
  });
  if (!profile || profile.services.length === 0) return [];

  const service = profile.services[0];
  const day = new Date(dayIso);
  const { start, end } = dayBoundsUtc(day);

  const existing = await db.booking.findMany({
    where: {
      barberId: profile.userId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startAt: { gte: start, lt: end },
    },
    select: { startAt: true, endAt: true },
  });

  const slots = generateSlots({
    day,
    availability: profile.weeklyAvailability as unknown as WeeklyAvailability,
    serviceDurationMin: service.durationMin,
    existingBookings: existing,
  });

  return slots.map((d) => d.toISOString());
}

export async function createBookingCheckoutAction(input: {
  slug: string;
  serviceId: string;
  startIso: string;
}): Promise<ActionResult> {
  const parsed = bookingInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };

  const session = await auth();

  const profile = await db.barberProfile.findUnique({
    where: { slug: parsed.data.slug },
    include: {
      user: { select: { id: true, name: true, referralCode: true } },
      services: { where: { id: parsed.data.serviceId, isActive: true } },
    },
  });
  if (!profile || profile.services.length === 0) {
    return { ok: false, error: "Barber or service not found" };
  }

  if (!session?.user) {
    const callbackUrl = `/book/${parsed.data.slug}`;
    const redirectTo = `/signup?ref=${encodeURIComponent(profile.user.referralCode)}&callbackUrl=${encodeURIComponent(callbackUrl)}`;
    return { ok: false, redirectTo };
  }

  if (session.user.id === profile.userId) {
    return { ok: false, error: "You can't book your own service" };
  }

  const service = profile.services[0];
  const startAt = new Date(parsed.data.startIso);
  if (Number.isNaN(startAt.getTime())) {
    return { ok: false, error: "Invalid slot" };
  }
  const endAt = addMinutes(startAt, service.durationMin);

  if (startAt.getTime() <= Date.now()) {
    return { ok: false, error: "That slot is in the past" };
  }

  const conflict = await db.booking.findFirst({
    where: {
      barberId: profile.userId,
      status: { in: ["PENDING", "CONFIRMED"] },
      AND: [{ startAt: { lt: endAt } }, { endAt: { gt: startAt } }],
    },
    select: { id: true },
  });
  if (conflict) {
    return { ok: false, error: "Slot no longer available" };
  }

  const booking = await db.booking.create({
    data: {
      barberId: profile.userId,
      clientId: session.user.id,
      serviceId: service.id,
      startAt,
      endAt,
      status: "PENDING",
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const stripeSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${service.name} with ${profile.user.name}`,
            description: startAt.toUTCString(),
          },
          unit_amount: service.priceCents,
        },
        quantity: 1,
      },
    ],
    customer_email: session.user.email ?? undefined,
    metadata: {
      bookingId: booking.id,
      productType: "BOOKING",
      clientId: session.user.id,
      barberId: profile.userId,
    },
    success_url: `${appUrl}/book/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/book/cancel?booking=${booking.id}`,
  });

  if (!stripeSession.url) {
    return { ok: false, error: "Stripe session missing URL" };
  }

  return { ok: true, checkoutUrl: stripeSession.url };
}
