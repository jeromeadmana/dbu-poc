"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { releaseEligibleCommissions } from "@/lib/commission/release";
import { recomputeWaiverStatus } from "@/lib/commission/waiver";
import type { Rank, Role } from "@prisma/client";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/signin?callbackUrl=/admin");
  }
  return session.user;
}

const ROLE_VALUES = ["CLIENT", "BARBER", "ADMIN"] as const;
const RANK_VALUES = ["MEMBER", "PRO", "ELITE", "COACH", "DYNASTY"] as const;

const updateUserSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLE_VALUES),
  rank: z.string().optional(),
});

export async function updateUserAction(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = updateUserSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
    rank: formData.get("rank")?.toString() || undefined,
  });
  if (!parsed.success) {
    redirect("/admin?error=invalid");
  }

  const { userId, role } = parsed.data;
  const rankRaw = parsed.data.rank;
  const rank: Rank | null =
    role === "BARBER" && rankRaw && (RANK_VALUES as readonly string[]).includes(rankRaw)
      ? (rankRaw as Rank)
      : role === "BARBER"
        ? "MEMBER"
        : null;

  // Guard: prevent demoting yourself (you'd lock yourself out of /admin).
  if (userId === admin.id && role !== "ADMIN") {
    redirect("/admin?error=cant-demote-self");
  }

  const before = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, rank: true },
  });
  if (!before) redirect("/admin?error=not-found");

  await db.user.update({
    where: { id: userId },
    data: { role: role as Role, rank },
  });

  await db.adminActionLog.create({
    data: {
      adminId: admin.id,
      action: "user.update",
      targetType: "user",
      targetId: userId,
      payload: {
        before: { role: before.role, rank: before.rank },
        after: { role, rank },
      },
    },
  });

  revalidatePath("/admin");
  redirect("/admin?ok=updated");
}

export async function releaseCommissionsAction() {
  const admin = await requireAdmin();
  const { released } = await releaseEligibleCommissions({ adminId: admin.id });
  revalidatePath("/admin");
  redirect(`/admin?ok=released-${released}`);
}

export async function recomputeWaiverAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = formData.get("userId")?.toString();
  if (!userId) redirect("/admin?error=invalid");

  const result = await recomputeWaiverStatus(userId as string);
  await db.adminActionLog.create({
    data: {
      adminId: admin.id,
      action: "user.waiver.recompute",
      targetType: "user",
      targetId: userId as string,
      payload: result as unknown as object,
    },
  });
  revalidatePath("/admin");
  redirect(`/admin?ok=waiver-${result.waived ? "on" : "off"}`);
}
