import type { Rank } from "@prisma/client";

/**
 * Max commission level a rank can earn on — when a payer makes a payment,
 * each upline at distance N can only receive an L_N commission if
 * their rank's depth covers N.
 *
 * Brief:   Member L1–L2 · Pro L1–L3 · Elite L1–L5 · Coach/Dynasty L1–L7
 */
export const RANK_DEPTH: Record<Rank, number> = {
  MEMBER: 2,
  PRO: 3,
  ELITE: 5,
  COACH: 7,
  DYNASTY: 7,
};

/** Absolute max level regardless of rank. */
export const MAX_LEVEL = 7;

/**
 * Commission percent per level in basis points (1 bp = 0.01%).
 * Integer math — avoids floating-point drift on money.
 * Total across all 7 levels = 2200 bp = 22.00%.
 */
export const LEVEL_PERCENT_BP: Record<number, number> = {
  1: 1000, // 10.00%
  2: 500,  //  5.00%
  3: 300,  //  3.00%
  4: 200,  //  2.00%
  5: 100,  //  1.00%
  6: 50,   //  0.50%
  7: 50,   //  0.50%
};

export function commissionAmountCents(paymentAmountCents: number, level: number): number {
  const bp = LEVEL_PERCENT_BP[level];
  if (!bp) return 0;
  return Math.floor((paymentAmountCents * bp) / 10_000);
}

/** Number of days to hold a commission as PENDING before it can be released to APPROVED. */
export function commissionHoldDays(): number {
  const raw = process.env.COMMISSION_HOLD_DAYS;
  if (!raw) return 14;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) return 14;
  return n;
}

/** Threshold of "active referrals" (sponsees who have made a first payment) to waive subscription. */
export const WAIVER_ACTIVE_REFERRAL_THRESHOLD = 3;
