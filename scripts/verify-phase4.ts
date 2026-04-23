/**
 * Phase 4 verification — commission engine (pure function + DB roundtrip).
 *
 * Seeds a 7-level barber chain with mixed ranks, fires a payment at the
 * bottom, and asserts that compression + level amounts + idempotency +
 * hasFirstPayment + waiver + release all behave correctly.
 *
 * Run: npm run verify:phase4
 * Idempotent: cleans up verify-phase4-* users first (FK-ordered).
 */

import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { generateUniqueReferralCode } from "../src/lib/referral";
import {
  computeCommissionAssignments,
  distributeCommissions,
} from "../src/lib/commission/distribute";
import { recomputeWaiverStatus } from "../src/lib/commission/waiver";
import { releaseEligibleCommissions } from "../src/lib/commission/release";
import { commissionAmountCents } from "../src/lib/commission/rates";
import type { Rank, Role } from "@prisma/client";

const EMAIL_PREFIX = "verify-phase4-";
const EMAIL_DOMAIN = "@test.dbu-poc";

async function createUser(opts: {
  tag: string;
  name: string;
  role?: Role;
  rank?: Rank;
  sponsorId?: string;
  hasFirstPayment?: boolean;
}) {
  const passwordHash = await bcrypt.hash("test-password-123", 10);
  const referralCode = await generateUniqueReferralCode();
  return db.user.create({
    data: {
      email: `${EMAIL_PREFIX}${opts.tag}${EMAIL_DOMAIN}`,
      passwordHash,
      name: opts.name,
      referralCode,
      sponsorId: opts.sponsorId ?? null,
      role: opts.role ?? "BARBER",
      rank: opts.rank ?? null,
      hasFirstPayment: opts.hasFirstPayment ?? false,
    },
    select: { id: true, name: true, referralCode: true, rank: true },
  });
}

async function cleanup() {
  const targets = await db.user.findMany({
    where: { email: { startsWith: EMAIL_PREFIX, endsWith: EMAIL_DOMAIN } },
    select: { id: true },
  });
  const ids = targets.map((u) => u.id);
  if (ids.length === 0) return;
  // FK order: commissions → payments → bookings → services → profiles → users
  await db.commission.deleteMany({
    where: { OR: [{ payerId: { in: ids } }, { beneficiaryId: { in: ids } }] },
  });
  await db.payment.deleteMany({ where: { userId: { in: ids } } });
  await db.booking.deleteMany({
    where: { OR: [{ clientId: { in: ids } }, { barberId: { in: ids } }] },
  });
  await db.service.deleteMany({ where: { barberProfileId: { in: ids } } });
  await db.barberProfile.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

function rand6() {
  return Math.random().toString(36).slice(2, 8);
}

async function createPayment(userId: string, amountCents: number) {
  return db.payment.create({
    data: {
      stripePaymentIntentId: `pi_test_${rand6()}${rand6()}`,
      userId,
      amountCents,
      productType: "MEMBERSHIP",
      status: "SUCCEEDED",
    },
  });
}

// ─── Pure-function scenario tests ─────────────────────────────────────────

function pureScenarios(): Array<[string, boolean]> {
  // Scenario A: full 7-level chain, every upline is COACH → no compression needed
  const allCoach = Array.from({ length: 7 }, (_, i) => ({
    userId: `u${i + 1}`,
    rank: "COACH" as Rank,
  }));
  const assignA = computeCommissionAssignments(allCoach, 100_000);
  const aLevels = assignA.map((a) => a.level).sort((a, b) => a - b);
  const aExpectedAmounts = [1, 2, 3, 4, 5, 6, 7].map((l) =>
    commissionAmountCents(100_000, l),
  );
  const aAmountsMatch = assignA
    .sort((a, b) => a.level - b.level)
    .every((a, i) => a.amountCents === aExpectedAmounts[i]);

  // Scenario B: compression — MEMBER at position 3 gets skipped for L3,
  // PRO at position 4 compresses up to claim L3.
  const mixedChain = [
    { userId: "u1", rank: "COACH" as Rank },   // L1
    { userId: "u2", rank: "MEMBER" as Rank },  // L2
    { userId: "u3", rank: "MEMBER" as Rank },  // (skip — depth 2, but L3 needed)
    { userId: "u4", rank: "PRO" as Rank },     // compresses to L3
    { userId: "u5", rank: "ELITE" as Rank },   // L4
    { userId: "u6", rank: "ELITE" as Rank },   // L5
    { userId: "u7", rank: "DYNASTY" as Rank }, // L6 (L7 lost — no upline left)
  ];
  const assignB = computeCommissionAssignments(mixedChain, 100_000);
  const b = Object.fromEntries(
    assignB.map((a) => [a.beneficiaryId, a.level]),
  );

  // Scenario C: top-of-chain — no upline, no commissions
  const assignC = computeCommissionAssignments([], 100_000);

  // Scenario D: upline with no rank (CLIENT in chain) — skipped
  const withClient = [
    { userId: "u1", rank: "MEMBER" as Rank },
    { userId: "u2", rank: null },
    { userId: "u3", rank: "PRO" as Rank },
  ];
  const assignD = computeCommissionAssignments(withClient, 100_000);
  const dHasU2 = assignD.some((a) => a.beneficiaryId === "u2");

  return [
    ["A: all-COACH chain gets 7 commissions", assignA.length === 7],
    ["A: levels are 1..7 exactly once", aLevels.join(",") === "1,2,3,4,5,6,7"],
    ["A: amounts match LEVEL_PERCENT_BP", aAmountsMatch],
    ["B: compression yields 6 assignments (L7 unfilled)", assignB.length === 6],
    ["B: u1 (COACH @ L1) earns L1", b["u1"] === 1],
    ["B: u2 (MEMBER @ L2) earns L2", b["u2"] === 2],
    ["B: u3 (MEMBER, can't cover L3) skipped", !("u3" in b)],
    ["B: u4 (PRO) compresses up to claim L3", b["u4"] === 3],
    ["B: u5 (ELITE) earns L4", b["u5"] === 4],
    ["B: u6 (ELITE) earns L5", b["u6"] === 5],
    ["B: u7 (DYNASTY) earns L6", b["u7"] === 6],
    ["C: empty upline → no commissions", assignC.length === 0],
    ["D: null-rank upline skipped", !dHasU2],
  ];
}

// ─── End-to-end DB scenario ───────────────────────────────────────────────

async function dbScenario(): Promise<Array<[string, boolean]>> {
  const amount = 100_000; // $1000

  // Seed the chain from top to bottom so sponsorIds can reference ancestors.
  // Chain (from payer upward):
  // payer → L1=COACH → L2=MEMBER → L3=MEMBER → L4=PRO → L5=ELITE → L6=ELITE → L7=DYNASTY
  const top = await createUser({ tag: "top-dynasty", name: "Top Dynasty", rank: "DYNASTY" });
  const l6 = await createUser({ tag: "l6-elite", name: "L6 Elite", rank: "ELITE", sponsorId: top.id });
  const l5 = await createUser({ tag: "l5-elite", name: "L5 Elite", rank: "ELITE", sponsorId: l6.id });
  const l4 = await createUser({ tag: "l4-pro", name: "L4 Pro", rank: "PRO", sponsorId: l5.id });
  const l3 = await createUser({ tag: "l3-member-skip", name: "L3 Member skipped", rank: "MEMBER", sponsorId: l4.id });
  const l2 = await createUser({ tag: "l2-member", name: "L2 Member", rank: "MEMBER", sponsorId: l3.id });
  const l1 = await createUser({ tag: "l1-coach", name: "L1 Coach", rank: "COACH", sponsorId: l2.id });
  const payer = await createUser({ tag: "payer", name: "Payer", role: "CLIENT", sponsorId: l1.id });

  const payment = await createPayment(payer.id, amount);
  const result = await distributeCommissions(payment.id);

  // Re-query to observe what actually landed in the DB
  const committed = await db.commission.findMany({
    where: { sourcePaymentId: payment.id },
    orderBy: { level: "asc" },
    select: { level: true, beneficiaryId: true, amountCents: true, status: true, rankAtPayout: true },
  });
  const beneficiaries = Object.fromEntries(committed.map((c) => [c.beneficiaryId, c]));

  const l1Got = beneficiaries[l1.id];
  const l2Got = beneficiaries[l2.id];
  const l3Got = beneficiaries[l3.id];
  const l4Got = beneficiaries[l4.id]; // PRO compressed up to L3
  const l5Got = beneficiaries[l5.id];
  const l6Got = beneficiaries[l6.id];
  const topGot = beneficiaries[top.id];

  // Idempotency: re-run, should create 0 new rows
  const second = await distributeCommissions(payment.id);

  // hasFirstPayment
  const payerAfter = await db.user.findUnique({
    where: { id: payer.id },
    select: { hasFirstPayment: true },
  });

  // Waiver scenario: create a separate sponsor with 3 BARBER sponsees; fire payments one by one
  const waiverSponsor = await createUser({ tag: "waiver-sponsor", name: "Waiver Sponsor", rank: "ELITE" });
  const s1 = await createUser({ tag: "waiver-s1", name: "Waiver S1", rank: "MEMBER", sponsorId: waiverSponsor.id });
  const s2 = await createUser({ tag: "waiver-s2", name: "Waiver S2", rank: "MEMBER", sponsorId: waiverSponsor.id });
  const s3 = await createUser({ tag: "waiver-s3", name: "Waiver S3", rank: "MEMBER", sponsorId: waiverSponsor.id });

  await distributeCommissions((await createPayment(s1.id, 10_000)).id);
  const afterOne = await db.user.findUnique({ where: { id: waiverSponsor.id }, select: { isSubscriptionWaived: true } });
  await distributeCommissions((await createPayment(s2.id, 10_000)).id);
  const afterTwo = await db.user.findUnique({ where: { id: waiverSponsor.id }, select: { isSubscriptionWaived: true } });
  await distributeCommissions((await createPayment(s3.id, 10_000)).id);
  const afterThree = await db.user.findUnique({ where: { id: waiverSponsor.id }, select: { isSubscriptionWaived: true } });

  // Release test: now + 30 days should release every PENDING that was set at hold = 14 days
  const before = await db.commission.count({ where: { status: "PENDING", sourcePaymentId: payment.id } });
  const nowFake = new Date();
  const releaseNothing = await releaseEligibleCommissions({ now: nowFake });
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const releaseAll = await releaseEligibleCommissions({ now: future });
  const after = await db.commission.count({ where: { status: "APPROVED", sourcePaymentId: payment.id } });

  // Recompute-idempotency
  const waiverRecompute = await recomputeWaiverStatus(waiverSponsor.id);

  return [
    ["6 commissions landed in DB for main chain", committed.length === 6],
    ["L1 Coach earned L1", l1Got?.level === 1],
    ["L1 amount = 10% of $1000 = $100", l1Got?.amountCents === commissionAmountCents(amount, 1)],
    ["L2 Member earned L2", l2Got?.level === 2],
    ["L2 amount = 5% of $1000 = $50", l2Got?.amountCents === commissionAmountCents(amount, 2)],
    ["L3 Member skipped (no commission)", !l3Got],
    ["L4 PRO compressed up to claim L3", l4Got?.level === 3],
    ["L4 compressed amount = 3% of $1000 = $30", l4Got?.amountCents === commissionAmountCents(amount, 3)],
    ["L5 ELITE earned L4", l5Got?.level === 4],
    ["L6 ELITE earned L5", l6Got?.level === 5],
    ["Top DYNASTY earned L6 (L7 lost — no upline left)", topGot?.level === 6],
    ["rankAtPayout captured on L1 as COACH", l1Got?.rankAtPayout === "COACH"],
    ["rankAtPayout captured on L4 compressed-to-L3 as PRO", l4Got?.rankAtPayout === "PRO"],
    ["All DB commissions start PENDING", committed.every((c) => c.status === "PENDING")],
    ["distributeCommissions result reports 6 created", result.created === 6],
    ["Second call creates 0, skips 6 (idempotent)", second.created === 0 && second.skipped === 6],
    ["Payer.hasFirstPayment flipped to true", payerAfter?.hasFirstPayment === true],
    ["After 1 referral: waiver stays false", afterOne?.isSubscriptionWaived === false],
    ["After 2 referrals: waiver stays false", afterTwo?.isSubscriptionWaived === false],
    ["After 3 referrals: waiver flips to true", afterThree?.isSubscriptionWaived === true],
    ["Recompute-waiver is idempotent (no change)", waiverRecompute.changed === false && waiverRecompute.waived === true],
    ["Release: before, 6 PENDING on main payment", before === 6],
    ["Release with now → 0 released (hold not elapsed)", releaseNothing.released === 0],
    ["Release with +30 days → releases 6+ commissions", releaseAll.released >= 6],
    ["After release: 6 APPROVED on main payment", after === 6],
  ];
}

async function main() {
  console.log("→ Cleaning up previous verification users (FK-ordered)...");
  await cleanup();

  console.log("\n→ Pure-function compression scenarios...");
  const pureAssertions = pureScenarios();

  console.log("\n→ DB end-to-end: 7-level chain + idempotency + waiver + release...");
  const dbAssertions = await dbScenario();

  const assertions = [...pureAssertions, ...dbAssertions];
  let failed = 0;
  console.log("\nAssertions:");
  for (const [label, ok] of assertions) {
    console.log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) failed++;
  }
  if (failed > 0) {
    console.error(`\n❌ ${failed} / ${assertions.length} assertion(s) failed.`);
    process.exit(1);
  }
  console.log(`\n✓ Phase 4 verified (${assertions.length}/${assertions.length}).`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
