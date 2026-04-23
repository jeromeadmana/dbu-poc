import type { Rank, Role } from "@prisma/client";

export type UnlockRule =
  | { type: "always" }
  | { type: "rank_gte"; value: Rank }
  | { type: "capacity_gte"; value: number }; // 0..1, e.g., 0.9 = 90%

const RANK_ORDER: Rank[] = ["MEMBER", "PRO", "ELITE", "COACH", "DYNASTY"];

export type UnlockContext = {
  role: Role;
  rank: Rank | null;
  capacityPct: number; // 0..100
};

export type UnlockResult =
  | { unlocked: true }
  | { unlocked: false; reason: string };

export function evaluateUnlockRule(rule: UnlockRule | null | undefined, ctx: UnlockContext): UnlockResult {
  // Admins see everything unlocked — they need to preview modules for curation.
  if (ctx.role === "ADMIN") return { unlocked: true };

  if (!rule || rule.type === "always") return { unlocked: true };

  if (rule.type === "rank_gte") {
    if (!ctx.rank) {
      return { unlocked: false, reason: `Requires rank ${rule.value}+ (become a barber first)` };
    }
    const needIdx = RANK_ORDER.indexOf(rule.value);
    const haveIdx = RANK_ORDER.indexOf(ctx.rank);
    if (haveIdx >= needIdx) return { unlocked: true };
    return { unlocked: false, reason: `Requires rank ${rule.value}+ (you're ${ctx.rank})` };
  }

  if (rule.type === "capacity_gte") {
    const threshold = rule.value * 100;
    if (ctx.capacityPct >= threshold) return { unlocked: true };
    return {
      unlocked: false,
      reason: `Hit ${threshold}% weekly capacity to unlock (you're at ${Math.round(ctx.capacityPct)}%)`,
    };
  }

  return { unlocked: false, reason: "Unknown unlock rule" };
}

/** Parse an unknown JSON value into an UnlockRule if it matches a known shape. */
export function parseUnlockRule(json: unknown): UnlockRule | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as { type?: string; value?: unknown };
  if (obj.type === "always") return { type: "always" };
  if (obj.type === "rank_gte" && typeof obj.value === "string" && RANK_ORDER.includes(obj.value as Rank)) {
    return { type: "rank_gte", value: obj.value as Rank };
  }
  if (obj.type === "capacity_gte" && typeof obj.value === "number") {
    return { type: "capacity_gte", value: obj.value };
  }
  return null;
}
