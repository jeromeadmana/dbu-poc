import { db } from "../db";

/**
 * Flips PENDING commissions → APPROVED for rows whose `releaseAt` has passed.
 *
 * This is the manual replacement for the nightly cron the brief described —
 * user opted out of Vercel Hobby crons, so an admin hits this from a button
 * (to be wired in Phase 8).
 *
 * If `adminId` is provided, an audit row is written to `dbu_admin_action_logs`.
 */
export async function releaseEligibleCommissions(options?: {
  adminId?: string;
  now?: Date;
}): Promise<{ released: number }> {
  const now = options?.now ?? new Date();

  const result = await db.commission.updateMany({
    where: { status: "PENDING", releaseAt: { lte: now } },
    data: { status: "APPROVED" },
  });

  if (options?.adminId && result.count > 0) {
    await db.adminActionLog.create({
      data: {
        adminId: options.adminId,
        action: "commission.release",
        targetType: "commission",
        targetId: "batch",
        payload: { releasedCount: result.count, runAt: now.toISOString() },
      },
    });
  }

  return { released: result.count };
}
