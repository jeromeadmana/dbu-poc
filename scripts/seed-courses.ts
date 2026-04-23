/**
 * Seed (or update) the demo course modules.
 *
 * Idempotent — matches by title; updates the rest in place so
 * existing CourseProgress rows still link up.
 *
 * Usage: npm run seed:courses
 */

import { db } from "../src/lib/db";
import type { Prisma } from "@prisma/client";

const MODULES: Array<{
  title: string;
  description: string;
  loomUrl: string;
  orderIndex: number;
  unlockRule: Prisma.InputJsonValue;
}> = [
  {
    title: "Getting Started with DBU",
    description: "Platform overview — how the referral network, bookings, and commissions connect.",
    loomUrl: "https://www.loom.com/share/a6f0e7a9d9b44b55b1b86c4e8f5e7d21",
    orderIndex: 1,
    unlockRule: { type: "always" },
  },
  {
    title: "The Pro Tier Playbook",
    description: "Five habits of barbers who made the jump from MEMBER to PRO within three months.",
    loomUrl: "https://www.loom.com/share/c5d8e7f9a1b2c3d4e5f6a7b8c9d0e1f2",
    orderIndex: 2,
    unlockRule: { type: "rank_gte", value: "PRO" },
  },
  {
    title: "Price Raise Masterclass",
    description: "The signature unlock: at 90% booking capacity, here's the script + confidence framework to raise your rates.",
    loomUrl: "https://www.loom.com/share/b2a1e9d8c7f6a5b4c3d2e1f0a9b8c7d6",
    orderIndex: 3,
    unlockRule: { type: "capacity_gte", value: 0.9 },
  },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const m of MODULES) {
    const existing = await db.courseModule.findFirst({ where: { title: m.title } });
    if (existing) {
      await db.courseModule.update({
        where: { id: existing.id },
        data: {
          description: m.description,
          loomUrl: m.loomUrl,
          orderIndex: m.orderIndex,
          unlockRule: m.unlockRule,
        },
      });
      updated++;
      console.log(`  ~ ${m.title}`);
    } else {
      await db.courseModule.create({ data: m });
      created++;
      console.log(`  + ${m.title}`);
    }
  }
  console.log(`\n✓ ${created} created, ${updated} updated.`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
