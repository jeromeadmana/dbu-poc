"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { DEFAULT_AVAILABILITY, makeBarberSlug } from "@/lib/booking";

export async function becomeBarberAction() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { barberProfile: true },
  });
  if (!user) redirect("/signin");

  if (user.barberProfile) {
    redirect("/barber");
  }

  const baseSlug = makeBarberSlug(user.name, user.referralCode);
  // In the unlikely case of a collision, append a numeric suffix.
  let slug = baseSlug;
  for (let i = 2; i < 100; i++) {
    const taken = await db.barberProfile.findUnique({ where: { slug } });
    if (!taken) break;
    slug = `${baseSlug}-${i}`;
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        role: "BARBER",
        rank: user.rank ?? "MEMBER",
      },
    });
    await tx.barberProfile.create({
      data: {
        userId: user.id,
        slug,
        bio: null,
        weeklyAvailability: DEFAULT_AVAILABILITY,
        services: {
          create: [
            { name: "Haircut", durationMin: 30, priceCents: 4000 },
            { name: "Haircut + Beard Trim", durationMin: 45, priceCents: 6000 },
          ],
        },
      },
    });
  });

  revalidatePath("/");
  revalidatePath("/barber");
  redirect("/barber");
}
