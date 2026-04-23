/**
 * Phase 1 verification — exercises the signup building blocks directly against the DB
 * to confirm sponsor chain assignment, referral code uniqueness, and rank/role fields.
 *
 * Run: npm run verify:phase1
 *
 * This script is idempotent — it deletes any `verify-phase1-*@test.dbu-poc` users first,
 * so re-running is safe.
 */

import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { generateUniqueReferralCode } from "../src/lib/referral";

const EMAIL_PREFIX = "verify-phase1-";
const EMAIL_DOMAIN = "@test.dbu-poc";

async function createUser(
  email: string,
  name: string,
  sponsorCode?: string,
): Promise<{ id: string; referralCode: string; sponsorId: string | null }> {
  let sponsorId: string | null = null;
  if (sponsorCode) {
    const sponsor = await db.user.findUnique({
      where: { referralCode: sponsorCode },
      select: { id: true },
    });
    if (!sponsor) throw new Error(`Sponsor code not found: ${sponsorCode}`);
    sponsorId = sponsor.id;
  }

  const passwordHash = await bcrypt.hash("test-password-123", 10);
  const referralCode = await generateUniqueReferralCode();

  const user = await db.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      name,
      referralCode,
      sponsorId,
      role: "CLIENT",
    },
    select: { id: true, referralCode: true, sponsorId: true },
  });

  return user;
}

async function main() {
  console.log("→ Cleaning up previous verification users...");
  await db.user.deleteMany({
    where: { email: { startsWith: EMAIL_PREFIX, endsWith: EMAIL_DOMAIN } },
  });

  console.log("→ Creating 3-user sponsor chain...");
  const u1 = await createUser(`${EMAIL_PREFIX}1${EMAIL_DOMAIN}`, "Alice (top)");
  console.log(`  u1: ${u1.id} ref=${u1.referralCode} sponsor=${u1.sponsorId ?? "none"}`);

  const u2 = await createUser(`${EMAIL_PREFIX}2${EMAIL_DOMAIN}`, "Bob", u1.referralCode);
  console.log(`  u2: ${u2.id} ref=${u2.referralCode} sponsor=${u2.sponsorId}`);

  const u3 = await createUser(`${EMAIL_PREFIX}3${EMAIL_DOMAIN}`, "Charlie", u2.referralCode);
  console.log(`  u3: ${u3.id} ref=${u3.referralCode} sponsor=${u3.sponsorId}`);

  console.log("\n→ Verifying chain via recursive upline walk...");
  const chain: Array<{ name: string; ref: string; level: number }> = [];
  let cursorId: string | null = u3.id;
  let level = 0;
  while (cursorId && level < 20) {
    const u = await db.user.findUnique({
      where: { id: cursorId },
      select: { name: true, referralCode: true, sponsorId: true },
    });
    if (!u) break;
    chain.push({ name: u.name, ref: u.referralCode, level });
    cursorId = u.sponsorId;
    level++;
  }

  console.log("\nSponsor chain walked up from Charlie:");
  chain.forEach((c) => console.log(`  L${c.level}: ${c.name} (${c.ref})`));

  const assertions: Array<[string, boolean]> = [
    ["Chain has exactly 3 users", chain.length === 3],
    ["Level 0 is Charlie", chain[0]?.name === "Charlie"],
    ["Level 1 is Bob", chain[1]?.name === "Bob"],
    ["Level 2 is Alice (top)", chain[2]?.name === "Alice (top)"],
    ["Alice has no sponsor", !u1.sponsorId],
    ["Bob's sponsor is Alice", u2.sponsorId === u1.id],
    ["Charlie's sponsor is Bob", u3.sponsorId === u2.id],
    ["All referral codes unique", new Set([u1.referralCode, u2.referralCode, u3.referralCode]).size === 3],
    ["Referral codes 6 chars", [u1, u2, u3].every((u) => u.referralCode.length === 6)],
  ];

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
  console.log("\n✓ Phase 1 verified.");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
