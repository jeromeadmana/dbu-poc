import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { walkUpline } from "../network";
import {
  MAX_LEVEL,
  RANK_DEPTH,
  commissionAmountCents,
  commissionHoldDays,
} from "./rates";
import { recomputeWaiverStatus } from "./waiver";

export type CommissionAssignment = {
  beneficiaryId: string;
  level: number;
  rankAtPayout: keyof typeof RANK_DEPTH;
  amountCents: number;
};

/**
 * Pure function (no DB): compute who earns at which level for a payment,
 * using rank compression.
 *
 * Rule: walk upline outward; each upline member claims the *lowest* unclaimed
 * level their rank depth covers. Ineligible uplines are skipped, so the next
 * eligible upline effectively "moves up" to fill the gap. Each upline earns
 * at most one commission per payment. Unfillable levels (rare, only if the
 * upline runs out before level 7) are lost.
 */
export function computeCommissionAssignments(
  upline: Array<{ userId: string; rank: keyof typeof RANK_DEPTH | null }>,
  paymentAmountCents: number,
): CommissionAssignment[] {
  const unclaimed: number[] = [];
  for (let l = 1; l <= MAX_LEVEL; l++) unclaimed.push(l);

  const assignments: CommissionAssignment[] = [];

  for (const u of upline) {
    if (!u.rank) continue; // CLIENT/ADMIN with no rank can't earn (only BARBERs have ranks)
    const depth = RANK_DEPTH[u.rank];
    const idx = unclaimed.findIndex((l) => l <= depth);
    if (idx === -1) continue;
    const level = unclaimed[idx];
    unclaimed.splice(idx, 1);

    const amountCents = commissionAmountCents(paymentAmountCents, level);
    if (amountCents <= 0) continue;

    assignments.push({
      beneficiaryId: u.userId,
      level,
      rankAtPayout: u.rank,
      amountCents,
    });

    if (unclaimed.length === 0) break;
  }

  return assignments;
}

export type DistributeResult = {
  paymentId: string;
  payerId: string;
  assignments: CommissionAssignment[];
  created: number; // rows newly inserted
  skipped: number; // rows that already existed (idempotency)
};

/**
 * Idempotent: writes Commission rows for a given payment.
 * Safe to call multiple times — the `(sourcePaymentId, beneficiaryId, level)`
 * unique index prevents duplicates.
 *
 * Also:
 *   - flips payer.hasFirstPayment to true on their first payment
 *   - recomputes waiver status for payer's direct sponsor
 */
export async function distributeCommissions(paymentId: string): Promise<DistributeResult> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, userId: true, amountCents: true },
  });
  if (!payment) throw new Error(`Payment not found: ${paymentId}`);

  const upline = await walkUpline(payment.userId, MAX_LEVEL);
  const assignments = computeCommissionAssignments(upline, payment.amountCents);

  const holdDays = commissionHoldDays();
  const releaseAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);

  let created = 0;
  let skipped = 0;

  // Write commissions idempotently inside a transaction.
  await db.$transaction(async (tx) => {
    for (const a of assignments) {
      const existing = await tx.commission.findUnique({
        where: {
          sourcePaymentId_beneficiaryId_level: {
            sourcePaymentId: payment.id,
            beneficiaryId: a.beneficiaryId,
            level: a.level,
          },
        },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await tx.commission.create({
        data: {
          sourcePaymentId: payment.id,
          beneficiaryId: a.beneficiaryId,
          payerId: payment.userId,
          level: a.level,
          rankAtPayout: a.rankAtPayout,
          amountCents: a.amountCents,
          status: "PENDING",
          releaseAt,
        } satisfies Prisma.CommissionUncheckedCreateInput,
      });
      created++;
    }

    // Flip payer.hasFirstPayment on their first-ever payment.
    const payer = await tx.user.findUnique({
      where: { id: payment.userId },
      select: { hasFirstPayment: true, sponsorId: true },
    });
    if (payer && !payer.hasFirstPayment) {
      await tx.user.update({
        where: { id: payment.userId },
        data: { hasFirstPayment: true },
      });
    }
  });

  // Recompute waiver status for the payer's direct sponsor (may now have hit the 3-referral threshold).
  const payer = await db.user.findUnique({
    where: { id: payment.userId },
    select: { sponsorId: true },
  });
  if (payer?.sponsorId) {
    await recomputeWaiverStatus(payer.sponsorId);
  }

  return {
    paymentId: payment.id,
    payerId: payment.userId,
    assignments,
    created,
    skipped,
  };
}
