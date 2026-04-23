import { startOfDay, subDays } from "date-fns";
import { db } from "./db";

export type BarberStats = {
  today: { count: number; revenueCents: number };
  week: { count: number; revenueCents: number };
  upcoming: { count: number };
  capacity: {
    bookedMin: number;
    targetMin: number;
    pct: number; // 0..100+, can exceed 100 if over-booked
    unlockThreshold: number; // the % at which the Price Raise module unlocks
    unlocked: boolean;
  };
  commissions: {
    pending: { count: number; sumCents: number };
    approved: { count: number; sumCents: number };
  };
};

const CAPACITY_UNLOCK_PCT = 90;

export async function getBarberStats(userId: string, capacityTargetHrs: number): Promise<BarberStats> {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const weekAgo = subDays(now, 7);

  const [
    todayRows,
    weekRows,
    upcomingCount,
    pendingAgg,
    approvedAgg,
  ] = await Promise.all([
    db.booking.findMany({
      where: {
        barberId: userId,
        status: { in: ["CONFIRMED", "PENDING"] },
        startAt: { gte: dayStart, lte: dayEnd },
      },
      select: { service: { select: { priceCents: true, durationMin: true } } },
    }),
    db.booking.findMany({
      where: {
        barberId: userId,
        status: "CONFIRMED",
        startAt: { gte: weekAgo, lte: now },
      },
      select: { service: { select: { priceCents: true, durationMin: true } } },
    }),
    db.booking.count({
      where: {
        barberId: userId,
        status: "CONFIRMED",
        startAt: { gt: dayEnd },
      },
    }),
    db.commission.aggregate({
      where: { beneficiaryId: userId, status: "PENDING" },
      _sum: { amountCents: true },
      _count: true,
    }),
    db.commission.aggregate({
      where: { beneficiaryId: userId, status: "APPROVED" },
      _sum: { amountCents: true },
      _count: true,
    }),
  ]);

  const todayRevenue = todayRows.reduce((s, b) => s + b.service.priceCents, 0);
  const weekRevenue = weekRows.reduce((s, b) => s + b.service.priceCents, 0);
  const bookedMin = weekRows.reduce((s, b) => s + b.service.durationMin, 0);
  const targetMin = capacityTargetHrs * 60;
  const pct = targetMin > 0 ? (bookedMin / targetMin) * 100 : 0;

  return {
    today: { count: todayRows.length, revenueCents: todayRevenue },
    week: { count: weekRows.length, revenueCents: weekRevenue },
    upcoming: { count: upcomingCount },
    capacity: {
      bookedMin,
      targetMin,
      pct,
      unlockThreshold: CAPACITY_UNLOCK_PCT,
      unlocked: pct >= CAPACITY_UNLOCK_PCT,
    },
    commissions: {
      pending: { count: pendingAgg._count, sumCents: pendingAgg._sum.amountCents ?? 0 },
      approved: { count: approvedAgg._count, sumCents: approvedAgg._sum.amountCents ?? 0 },
    },
  };
}
