import type { Role, Rank } from "@prisma/client";
import { db } from "./db";

export type NetworkUser = {
  userId: string;
  name: string;
  role: Role;
  rank: Rank | null;
  referralCode: string;
  hasFirstPayment: boolean;
};

export type UplineNode = NetworkUser & {
  /** 1 = direct sponsor, 2 = sponsor's sponsor, ... */
  level: number;
};

export type DownlineNode = NetworkUser & {
  /** 1 = direct sponsee, 2 = sponsee's sponsee, ... */
  level: number;
  children: DownlineNode[];
};

/**
 * Walk from `userId` up the sponsor chain, returning at most `maxLevels` uplines
 * in order from closest (level 1) to farthest.
 *
 * Used by the commission engine (Phase 5) to distribute payouts.
 * Safety bound: stops at `maxLevels` even if cycles were somehow introduced.
 */
export async function walkUpline(
  userId: string,
  maxLevels = 7,
): Promise<UplineNode[]> {
  const uplines: UplineNode[] = [];
  let nextSponsorId: string | null = null;

  const start = await db.user.findUnique({
    where: { id: userId },
    select: { sponsorId: true },
  });
  if (!start) return uplines;
  nextSponsorId = start.sponsorId;

  for (let level = 1; level <= maxLevels; level++) {
    if (!nextSponsorId) break;
    const sponsor = await db.user.findUnique({
      where: { id: nextSponsorId },
      select: {
        id: true,
        name: true,
        role: true,
        rank: true,
        referralCode: true,
        hasFirstPayment: true,
        sponsorId: true,
      },
    });
    if (!sponsor) break;

    uplines.push({
      userId: sponsor.id,
      name: sponsor.name,
      role: sponsor.role,
      rank: sponsor.rank,
      referralCode: sponsor.referralCode,
      hasFirstPayment: sponsor.hasFirstPayment,
      level,
    });
    nextSponsorId = sponsor.sponsorId;
  }

  return uplines;
}

/**
 * Walk from `userId` down the sponsee tree via BFS per level,
 * returning nested children down to `maxDepth`.
 *
 * POC uses per-level queries (O(depth) round-trips) for readability;
 * a recursive CTE would be a single query if this ever becomes a hot path.
 */
export async function walkDownline(
  userId: string,
  maxDepth = 5,
): Promise<DownlineNode[]> {
  async function fetchChildren(
    parentId: string,
    level: number,
  ): Promise<DownlineNode[]> {
    if (level > maxDepth) return [];
    const children = await db.user.findMany({
      where: { sponsorId: parentId },
      select: {
        id: true,
        name: true,
        role: true,
        rank: true,
        referralCode: true,
        hasFirstPayment: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return Promise.all(
      children.map(async (c) => ({
        userId: c.id,
        name: c.name,
        role: c.role,
        rank: c.rank,
        referralCode: c.referralCode,
        hasFirstPayment: c.hasFirstPayment,
        level,
        children: await fetchChildren(c.id, level + 1),
      })),
    );
  }

  return fetchChildren(userId, 1);
}

/** Count every user in the downline tree (all depths, all branches). */
export function countDownline(tree: DownlineNode[]): number {
  let count = 0;
  for (const node of tree) {
    count += 1 + countDownline(node.children);
  }
  return count;
}
