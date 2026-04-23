/**
 * Phase 3 verification:
 * - Slot generator correctness (pure function, no DB / no network)
 * - End-to-end: create barber → create booking → call real Stripe test mode
 *   to prove STRIPE_SECRET_KEY works and metadata round-trips.
 *
 * Run: npm run verify:phase3
 * Idempotent: cleans up verify-phase3-* users first.
 */

import bcrypt from "bcryptjs";
import { addDays, addMinutes, set, startOfDay } from "date-fns";
import { db } from "../src/lib/db";
import { stripe } from "../src/lib/stripe";
import { generateUniqueReferralCode } from "../src/lib/referral";
import {
  DEFAULT_AVAILABILITY,
  generateSlots,
  makeBarberSlug,
} from "../src/lib/booking";

const EMAIL_PREFIX = "verify-phase3-";
const EMAIL_DOMAIN = "@test.dbu-poc";

async function slotGeneratorTests(): Promise<Array<[string, boolean]>> {
  // Pick a day far enough in the future that all slots are in the future
  // regardless of the server's local timezone.
  const future = addDays(startOfDay(new Date()), 14); // 2 weeks out, any weekday
  const distantPast = new Date("2020-01-01T00:00:00.000Z");

  // Normalize to a known weekday: find the next Wednesday after `future`.
  const daysToWed = (3 - future.getDay() + 7) % 7;
  const wed = addDays(future, daysToWed || 7);
  const thu = addDays(wed, 1);
  const sat = addDays(wed, 3);

  // Baseline: wed 9-17, 30-min service, no existing bookings, "now" in the past
  const baseSlots = generateSlots({
    day: wed,
    availability: DEFAULT_AVAILABILITY,
    serviceDurationMin: 30,
    existingBookings: [],
    now: distantPast,
  });

  // Duration fit: every slot + 30min must be <= interval end
  const lastFits = baseSlots.length > 0 && (() => {
    const last = baseSlots[baseSlots.length - 1];
    const end = addMinutes(last, 30);
    const expectedEnd = set(wed, { hours: 17, minutes: 0, seconds: 0, milliseconds: 0 });
    return end.getTime() <= expectedEnd.getTime();
  })();

  // Saturday: no availability → no slots
  const satSlots = generateSlots({
    day: sat,
    availability: DEFAULT_AVAILABILITY,
    serviceDurationMin: 30,
    existingBookings: [],
    now: distantPast,
  });

  // Past filter: set `now` mid-day and confirm all returned slots start at-or-after `now`
  const midWed = set(wed, { hours: 13, minutes: 0, seconds: 0, milliseconds: 0 });
  const filteredSlots = generateSlots({
    day: wed,
    availability: DEFAULT_AVAILABILITY,
    serviceDurationMin: 30,
    existingBookings: [],
    now: midWed,
  });
  const allAfterMid = filteredSlots.every((s) => s.getTime() >= midWed.getTime());

  // Existing booking blocks overlapping slots
  const thuStart = set(thu, { hours: 10, minutes: 0, seconds: 0, milliseconds: 0 });
  const thuEnd = addMinutes(thuStart, 60);
  const thuSlots = generateSlots({
    day: thu,
    availability: DEFAULT_AVAILABILITY,
    serviceDurationMin: 30,
    existingBookings: [{ startAt: thuStart, endAt: thuEnd }],
    now: distantPast,
  });
  const noneOverlapBooking = thuSlots.every((slot) => {
    const end = addMinutes(slot, 30);
    return !(slot < thuEnd && thuStart < end);
  });
  // Slot that ends exactly at 10:00 (i.e. starts at 09:30) should still be allowed
  const abuttingSlot = set(thu, { hours: 9, minutes: 30, seconds: 0, milliseconds: 0 });
  const hasAbuttingBefore = thuSlots.some((s) => s.getTime() === abuttingSlot.getTime());
  // Slot that starts exactly at 11:00 (after booking ends) should be allowed
  const afterBookingSlot = set(thu, { hours: 11, minutes: 0, seconds: 0, milliseconds: 0 });
  const hasAfterSlot = thuSlots.some((s) => s.getTime() === afterBookingSlot.getTime());

  // Service longer than any availability interval → no slots
  const hugeSlots = generateSlots({
    day: wed,
    availability: { ...DEFAULT_AVAILABILITY, wed: [["09:00", "09:30"]] },
    serviceDurationMin: 120,
    existingBookings: [],
    now: distantPast,
  });

  return [
    ["baseline generates some slots", baseSlots.length > 0],
    ["last slot + duration fits inside interval end", lastFits],
    ["saturday (no availability) returns no slots", satSlots.length === 0],
    ["past filter: all returned slots >= 'now'", allAfterMid],
    ["past filter drops some slots vs baseline", filteredSlots.length < baseSlots.length],
    ["existing 10:00–11:00 booking blocks overlapping slots", noneOverlapBooking],
    ["slot at 09:30 abutting booking remains available", hasAbuttingBefore],
    ["slot at 11:00 after booking remains available", hasAfterSlot],
    ["service longer than interval → no slots", hugeSlots.length === 0],
  ];
}

async function stripeEndToEndTest(): Promise<Array<[string, boolean]>> {
  // Seed a barber with profile + services
  const passwordHash = await bcrypt.hash("test-password-123", 10);
  const barberRef = await generateUniqueReferralCode();
  const barber = await db.user.create({
    data: {
      email: `${EMAIL_PREFIX}barber${EMAIL_DOMAIN}`,
      passwordHash,
      name: "Phase3 Barber",
      referralCode: barberRef,
      role: "BARBER",
      rank: "MEMBER",
    },
  });

  const slug = makeBarberSlug(barber.name, barber.referralCode);
  const profile = await db.barberProfile.create({
    data: {
      userId: barber.id,
      slug,
      weeklyAvailability: DEFAULT_AVAILABILITY,
      services: {
        create: [{ name: "Haircut", durationMin: 30, priceCents: 4000 }],
      },
    },
    include: { services: true },
  });

  // Seed a client
  const clientRef = await generateUniqueReferralCode();
  const client = await db.user.create({
    data: {
      email: `${EMAIL_PREFIX}client${EMAIL_DOMAIN}`,
      passwordHash,
      name: "Phase3 Client",
      referralCode: clientRef,
      role: "CLIENT",
    },
  });

  const service = profile.services[0];
  const startAt = addDays(startOfDay(new Date()), 7); // a week out at 00:00
  const bookingStart = set(startAt, { hours: 10, minutes: 0, seconds: 0, milliseconds: 0 });
  const bookingEnd = addMinutes(bookingStart, service.durationMin);

  const booking = await db.booking.create({
    data: {
      barberId: barber.id,
      clientId: client.id,
      serviceId: service.id,
      startAt: bookingStart,
      endAt: bookingEnd,
      status: "PENDING",
    },
  });

  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${service.name} with ${barber.name}`,
            description: bookingStart.toUTCString(),
          },
          unit_amount: service.priceCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      bookingId: booking.id,
      productType: "BOOKING",
    },
    success_url: "http://localhost:3000/book/success?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: `http://localhost:3000/book/cancel?booking=${booking.id}`,
  });

  console.log(`  stripe checkout session = ${checkout.id}`);
  console.log(`  checkout url = ${checkout.url?.slice(0, 50)}...`);

  return [
    ["stripe session has an id", !!checkout.id && checkout.id.startsWith("cs_")],
    ["stripe session has a checkout URL", !!checkout.url && checkout.url.startsWith("https://")],
    ["metadata round-trips bookingId", checkout.metadata?.bookingId === booking.id],
    ["metadata round-trips productType=BOOKING", checkout.metadata?.productType === "BOOKING"],
    ["amount_total matches service price", checkout.amount_total === service.priceCents],
    ["currency is usd", checkout.currency === "usd"],
    ["session status is open", checkout.status === "open"],
  ];
}

async function main() {
  console.log("→ Cleaning up previous verification users (ordered: bookings → services → profiles → users)...");
  const targetUsers = await db.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX, endsWith: EMAIL_DOMAIN } },
    select: { id: true },
  });
  const userIds = targetUsers.map((u) => u.id);
  if (userIds.length > 0) {
    await db.booking.deleteMany({
      where: { OR: [{ clientId: { in: userIds } }, { barberId: { in: userIds } }] },
    });
    await db.service.deleteMany({
      where: { barberProfileId: { in: userIds } },
    });
    await db.barberProfile.deleteMany({
      where: { userId: { in: userIds } },
    });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }

  console.log("\n→ Slot generator tests (pure function)...");
  const slotAssertions = await slotGeneratorTests();

  console.log("\n→ End-to-end: seed barber, create booking, call Stripe test mode...");
  const stripeAssertions = await stripeEndToEndTest();

  const assertions = [...slotAssertions, ...stripeAssertions];

  let failed = 0;
  console.log("\nAssertions:");
  for (const [label, ok] of assertions) {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`\n❌ ${failed} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\n✓ Phase 3 verified.");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
