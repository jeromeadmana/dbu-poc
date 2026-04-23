"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getBarberStats } from "@/lib/barber-stats";
import { evaluateUnlockRule, parseUnlockRule } from "@/lib/courses";

export async function toggleCompleteAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/courses");

  const moduleId = formData.get("moduleId")?.toString();
  if (!moduleId) redirect("/courses?error=invalid");

  const mod = await db.courseModule.findUnique({
    where: { id: moduleId },
    select: { id: true, unlockRule: true },
  });
  if (!mod) redirect("/courses?error=not-found");

  // Server-side unlock check (UI is not authoritative).
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, rank: true, barberProfile: { select: { userId: true, capacityTargetHrs: true } } },
  });
  if (!user) redirect("/signin");

  let capacityPct = 0;
  if (user.barberProfile) {
    const stats = await getBarberStats(user.barberProfile.userId, user.barberProfile.capacityTargetHrs);
    capacityPct = stats.capacity.pct;
  }

  const verdict = evaluateUnlockRule(parseUnlockRule(mod.unlockRule), {
    role: user.role,
    rank: user.rank,
    capacityPct,
  });
  if (!verdict.unlocked) {
    redirect(`/courses?error=locked`);
  }

  const existing = await db.courseProgress.findUnique({
    where: { userId_moduleId: { userId: session.user.id, moduleId: mod.id } },
    select: { completedAt: true },
  });

  if (existing?.completedAt) {
    await db.courseProgress.update({
      where: { userId_moduleId: { userId: session.user.id, moduleId: mod.id } },
      data: { completedAt: null },
    });
  } else {
    await db.courseProgress.upsert({
      where: { userId_moduleId: { userId: session.user.id, moduleId: mod.id } },
      create: { userId: session.user.id, moduleId: mod.id, completedAt: new Date() },
      update: { completedAt: new Date() },
    });
  }

  revalidatePath("/courses");
  revalidatePath(`/courses/${mod.id}`);
  redirect(`/courses/${mod.id}`);
}
