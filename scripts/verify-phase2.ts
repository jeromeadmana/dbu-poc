/**
 * Phase 2 verification — exercises walkUpline / walkDownline against a seeded
 * 4-level network (A → B → {C1, C2} → D).
 *
 * Run: npm run verify:phase2
 * Idempotent: cleans up any `verify-phase2-*@test.dbu-poc` users first.
 */

import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { generateUniqueReferralCode } from "../src/lib/referral";
import { walkUpline, walkDownline, countDownline } from "../src/lib/network";

const EMAIL_PREFIX = "verify-phase2-";
const EMAIL_DOMAIN = "@test.dbu-poc";

async function createUser(name: string, sponsorId: string | null) {
  const passwordHash = await bcrypt.hash("test-password-123", 10);
  const referralCode = await generateUniqueReferralCode();
  return db.user.create({
    data: {
      email: `${EMAIL_PREFIX}${name.toLowerCase().replace(/\s+/g, "-")}${EMAIL_DOMAIN}`,
      passwordHash,
      name,
      referralCode,
      sponsorId,
      role: "CLIENT",
    },
    select: { id: true, name: true, referralCode: true },
  });
}

async function main() {
  console.log("→ Cleaning up previous verification users...");
  await db.user.deleteMany({
    where: { email: { startsWith: EMAIL_PREFIX, endsWith: EMAIL_DOMAIN } },
  });

  console.log("→ Creating 4-level network: A → B → {C1, C2} → D");
  const a = await createUser("A-top", null);
  const b = await createUser("B", a.id);
  const c1 = await createUser("C1", b.id);
  const c2 = await createUser("C2", b.id);
  const d = await createUser("D-deepest", c1.id);

  console.log(`  A=${a.referralCode}  B=${b.referralCode}  C1=${c1.referralCode}  C2=${c2.referralCode}  D=${d.referralCode}`);

  console.log("\n→ walkUpline(D) — expecting [C1, B, A]");
  const uplineD = await walkUpline(d.id, 7);
  uplineD.forEach((u) => console.log(`  L${u.level}: ${u.name} (${u.referralCode})`));

  console.log("\n→ walkUpline(D, maxLevels=2) — expecting [C1, B] only");
  const uplineDCapped = await walkUpline(d.id, 2);
  uplineDCapped.forEach((u) => console.log(`  L${u.level}: ${u.name}`));

  console.log("\n→ walkDownline(A) — expecting full tree rooted at B");
  const downlineA = await walkDownline(a.id, 5);
  const countA = countDownline(downlineA);
  console.log(`  total nodes = ${countA}`);
  console.log(`  tree: ${JSON.stringify(downlineA.map((n) => ({ name: n.name, kids: n.children.map((c) => c.name) })))}`);

  console.log("\n→ walkDownline(A, maxDepth=1) — expecting only B (direct sponsees)");
  const downlineADepth1 = await walkDownline(a.id, 1);

  const assertions: Array<[string, boolean]> = [
    ["walkUpline(D) returns 3 ancestors", uplineD.length === 3],
    ["upline order: L1=C1, L2=B, L3=A", uplineD[0]?.name === "C1" && uplineD[1]?.name === "B" && uplineD[2]?.name === "A-top"],
    ["walkUpline(A-top) returns []", (await walkUpline(a.id, 7)).length === 0],
    ["walkUpline maxLevels=2 truncates to 2", uplineDCapped.length === 2],
    ["walkDownline(A) returns 1 root (B)", downlineA.length === 1 && downlineA[0]?.name === "B"],
    ["B has 2 direct children (C1, C2)", downlineA[0]?.children.length === 2],
    ["C1 has 1 child (D), C2 has 0", (() => {
      const b = downlineA[0];
      const c1Node = b?.children.find((c) => c.name === "C1");
      const c2Node = b?.children.find((c) => c.name === "C2");
      return c1Node?.children.length === 1 && c2Node?.children.length === 0;
    })()],
    ["countDownline(A) === 4", countA === 4],
    ["walkDownline(A, maxDepth=1) returns B with no children", downlineADepth1.length === 1 && downlineADepth1[0]?.children.length === 0],
    ["levels are 1-indexed (closest = 1)", uplineD[0]?.level === 1 && downlineA[0]?.level === 1],
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
  console.log("\n✓ Phase 2 verified.");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
