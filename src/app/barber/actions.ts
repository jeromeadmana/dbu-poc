"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, unstable_update } from "@/auth";
import { db } from "@/lib/db";
import { DEFAULT_AVAILABILITY, makeBarberSlug } from "@/lib/booking";
import { createMembershipCheckoutSession } from "@/lib/stripe-membership";

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

  const newRank = user.rank ?? "MEMBER";

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        role: "BARBER",
        rank: newRank,
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

  // Refresh the JWT so middleware sees the new role on the very next request —
  // otherwise the stale `role=CLIENT` claim bounces the user at /barber.
  await unstable_update({ user: { role: "BARBER", rank: newRank } });

  revalidatePath("/");
  revalidatePath("/barber");
  redirect("/barber");
}

export async function startMembershipAction() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/barber");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, stripeSubscriptionId: true },
  });
  if (!user) redirect("/signin");
  if (user.stripeSubscriptionId) redirect("/barber?membership=active");

  const checkoutUrl = await createMembershipCheckoutSession({
    userId: user.id,
    userEmail: user.email,
  });
  redirect(checkoutUrl);
}
