import { db } from "../db";
import { WAIVER_ACTIVE_REFERRAL_THRESHOLD } from "./rates";

/**
 * "Active referral" = a direct sponsee (role BARBER) who has made their first payment.
 *
 * If a user has >= WAIVER_ACTIVE_REFERRAL_THRESHOLD active referrals they get
 * isSubscriptionWaived = true ("free app"). Falls below → waiver removed.
 *
 * POC: only sets the DB flag. Real Stripe subscription pause/resume lives in
 * Phase 5 (webhook layer) and is out of POC scope per the agreed cuts.
 */
export async function recomputeWaiverStatus(userId: string): Promise<{
  userId: string;
  activeReferrals: number;
  waived: boolean;
  changed: boolean;
}> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isSubscriptionWaived: true },
  });
  if (!user) {
    return { userId, activeReferrals: 0, waived: false, changed: false };
  }

  const activeReferrals = await db.user.count({
    where: {
      sponsorId: userId,
      role: "BARBER",
      hasFirstPayment: true,
    },
  });

  const shouldBeWaived = activeReferrals >= WAIVER_ACTIVE_REFERRAL_THRESHOLD;

  if (shouldBeWaived === user.isSubscriptionWaived) {
    return { userId, activeReferrals, waived: shouldBeWaived, changed: false };
  }

  await db.user.update({
    where: { id: userId },
    data: { isSubscriptionWaived: shouldBeWaived },
  });

  return { userId, activeReferrals, waived: shouldBeWaived, changed: true };
}
