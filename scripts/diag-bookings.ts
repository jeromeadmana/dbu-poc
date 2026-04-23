/**
 * Diagnostic: show the most recent bookings per barber profile,
 * with status + timestamps. Use to figure out why a booking
 * isn't appearing on the barber dashboard.
 *
 * Run: npm run diag:bookings
 */

import { db } from "../src/lib/db";

async function main() {
  const profiles = await db.barberProfile.findMany({
    include: {
      user: { select: { email: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  for (const p of profiles) {
    const bookings = await db.booking.findMany({
      where: { barberId: p.userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        client: { select: { email: true, name: true } },
        service: { select: { name: true } },
      },
    });

    if (bookings.length === 0) continue;

    console.log(`\n═══ ${p.user.name} <${p.user.email}>  slug=${p.slug}`);
    for (const b of bookings) {
      console.log(
        `  [${b.status.padEnd(10)}] ${b.startAt.toISOString()}  ${b.service.name}  by ${b.client.name} <${b.client.email}>`,
      );
      console.log(
        `     bookingId=${b.id}  paymentIntent=${b.stripePaymentIntentId ?? "null"}  created=${b.createdAt.toISOString()}`,
      );
      const payment = b.stripePaymentIntentId
        ? await db.payment.findUnique({ where: { stripePaymentIntentId: b.stripePaymentIntentId } })
        : null;
      if (payment) {
        console.log(`     payment: ${payment.status} $${(payment.amountCents / 100).toFixed(2)}`);
      } else if (b.stripePaymentIntentId) {
        console.log(`     ⚠ paymentIntent set on booking but no Payment row`);
      }
    }
  }

  const recentWebhooks = await db.webhookEvent.findMany({
    orderBy: { processedAt: "desc" },
    take: 10,
    select: { stripeEventId: true, type: true, processedAt: true },
  });
  console.log("\n═══ Recent webhook events");
  for (const w of recentWebhooks) {
    console.log(`  ${w.processedAt.toISOString()}  ${w.type}  ${w.stripeEventId}`);
  }

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
