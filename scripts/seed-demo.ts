/**
 * Full demo seed — builds a realistic playable state:
 *
 *   Don Dynasty (DYNASTY barber, no sponsor)
 *     └─ Elena Elite (ELITE barber)
 *         └─ Pat Pro (PRO barber)
 *             └─ Matt Member (MEMBER barber, with profile + services + 1 booking)
 *                 └─ Carla Client (CLIENT)
 *
 *   Alice Admin (separate, ADMIN role)
 *
 * Also: one synthetic $29 MEMBERSHIP payment from Matt so commissions
 * actually distribute up the chain — you'll see real rows in /admin.
 *
 * All emails end in `@dbu-poc.test` (valid TLD, passes zod's email regex).
 * Password for every demo user: `demo1234`.
 *
 * Idempotent: deletes existing demo-* users (FK-ordered) and rebuilds fresh.
 * Usage: npm run seed:demo
 */

import bcrypt from "bcryptjs";
import { addDays, addMinutes, set, startOfDay } from "date-fns";
import { db } from "../src/lib/db";
import { generateUniqueReferralCode } from "../src/lib/referral";
import { DEFAULT_AVAILABILITY, makeBarberSlug } from "../src/lib/booking";
import { distributeCommissions } from "../src/lib/commission/distribute";
import type { Prisma, Rank, Role } from "@prisma/client";

const EMAIL_PREFIX = "demo-";
const EMAIL_DOMAIN = "@dbu-poc.test";
const PASSWORD = "demo1234";

type SeedUser = {
  tag: string;
  name: string;
  role: Role;
  rank: Rank | null;
  sponsorTag: string | null;
  barberProfile?: { serviceMenu?: Array<{ name: string; durationMin: number; priceCents: number }> };
};

const SEED: SeedUser[] = [
  { tag: "admin", name: "Alice Admin", role: "ADMIN", rank: null, sponsorTag: null },
  { tag: "dynasty", name: "Don Dynasty", role: "BARBER", rank: "DYNASTY", sponsorTag: null, barberProfile: {} },
  { tag: "elite",   name: "Elena Elite", role: "BARBER", rank: "ELITE", sponsorTag: "dynasty", barberProfile: {} },
  { tag: "pro",     name: "Pat Pro",     role: "BARBER", rank: "PRO",   sponsorTag: "elite",  barberProfile: {} },
  {
    tag: "member",
    name: "Matt Member",
    role: "BARBER",
    rank: "MEMBER",
    sponsorTag: "pro",
    barberProfile: {
      serviceMenu: [
        { name: "Haircut", durationMin: 30, priceCents: 4000 },
        { name: "Haircut + Beard Trim", durationMin: 45, priceCents: 6000 },
        { name: "Fade + Line Up", durationMin: 40, priceCents: 5500 },
      ],
    },
  },
  { tag: "client1", name: "Carla Client", role: "CLIENT", rank: null, sponsorTag: "member" },
];

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
  await db.adminActionLog.deleteMany({ where: { adminId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  console.log("→ cleanup demo users…");
  await cleanup();

  console.log("→ creating demo users…");
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const byTag = new Map<string, { id: string; referralCode: string }>();

  for (const u of SEED) {
    const sponsorId = u.sponsorTag ? byTag.get(u.sponsorTag)?.id ?? null : null;
    const referralCode = await generateUniqueReferralCode();
    const created = await db.user.create({
      data: {
        email: `${EMAIL_PREFIX}${u.tag}${EMAIL_DOMAIN}`,
        passwordHash,
        name: u.name,
        referralCode,
        role: u.role,
        rank: u.rank,
        sponsorId,
      },
      select: { id: true, referralCode: true },
    });
    byTag.set(u.tag, created);
    console.log(`  + ${u.name.padEnd(14)} ${u.role.padEnd(6)} ${(u.rank ?? "").padEnd(8)} ref=${created.referralCode}`);

    if (u.barberProfile) {
      const slug = makeBarberSlug(u.name, created.referralCode);
      const menu = u.barberProfile.serviceMenu ?? [
        { name: "Haircut", durationMin: 30, priceCents: 4000 },
        { name: "Haircut + Beard Trim", durationMin: 45, priceCents: 6000 },
      ];
      await db.barberProfile.create({
        data: {
          userId: created.id,
          slug,
          weeklyAvailability: DEFAULT_AVAILABILITY as unknown as Prisma.InputJsonValue,
          capacityTargetHrs: 40,
          services: { create: menu },
        },
      });
    }
  }

  // Seed a few confirmed bookings for Matt Member so /barber has content
  console.log("→ seeding bookings…");
  const matt = byTag.get("member")!;
  const carla = byTag.get("client1")!;
  const mattProfile = await db.barberProfile.findUniqueOrThrow({
    where: { userId: matt.id },
    include: { services: true },
  });
  const haircut = mattProfile.services[0];

  const tomorrow = addDays(startOfDay(new Date()), 1);
  for (let i = 0; i < 3; i++) {
    const start = set(addDays(tomorrow, i), { hours: 10 + i, minutes: 0, seconds: 0, milliseconds: 0 });
    const end = addMinutes(start, haircut.durationMin);
    await db.booking.create({
      data: {
        barberId: matt.id,
        clientId: carla.id,
        serviceId: haircut.id,
        startAt: start,
        endAt: end,
        status: "CONFIRMED",
        stripePaymentIntentId: `pi_seed_${matt.id.slice(0, 6)}_${i}`,
      },
    });
    await db.payment.create({
      data: {
        stripePaymentIntentId: `pi_seed_${matt.id.slice(0, 6)}_${i}`,
        userId: carla.id,
        amountCents: haircut.priceCents,
        productType: "BOOKING",
        status: "SUCCEEDED",
      },
    });
  }
  console.log(`  + 3 confirmed bookings Carla → Matt`);

  // Seed one MEMBERSHIP payment from Matt so commissions flow up the chain
  console.log("→ distributing one membership commission up the chain…");
  const membershipPayment = await db.payment.create({
    data: {
      stripePaymentIntentId: `pi_seed_membership_${matt.id.slice(0, 8)}`,
      userId: matt.id,
      amountCents: 2900,
      productType: "MEMBERSHIP",
      status: "SUCCEEDED",
    },
  });
  const result = await distributeCommissions(membershipPayment.id);
  console.log(`  + ${result.created} commission rows written`);
  for (const a of result.assignments) {
    console.log(`      L${a.level} ${a.rankAtPayout.padEnd(8)} $${(a.amountCents / 100).toFixed(2)}`);
  }

  console.log("\n✓ demo seed complete\n");
  console.log("Demo accounts (password for all: demo1234):");
  for (const u of SEED) {
    console.log(`  ${EMAIL_PREFIX}${u.tag}${EMAIL_DOMAIN}  —  ${u.name} (${u.role}${u.rank ? ", " + u.rank : ""})`);
  }

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
