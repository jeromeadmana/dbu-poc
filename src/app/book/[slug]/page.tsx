import { notFound } from "next/navigation";
import { addDays, format, startOfDay } from "date-fns";
import { db } from "@/lib/db";
import { BookingForm } from "./BookingForm";

export default async function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const profile = await db.barberProfile.findUnique({
    where: { slug },
    include: {
      user: { select: { name: true, rank: true } },
      services: { where: { isActive: true }, orderBy: { priceCents: "asc" } },
    },
  });

  if (!profile) notFound();

  const today = startOfDay(new Date());
  const dayOptions = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i);
    return {
      iso: d.toISOString(),
      label: i === 0 ? "Today" : format(d, "MMM d"),
      sub: format(d, "EEE"),
    };
  });

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="text-xs uppercase text-zinc-500">Book with</div>
          <h1 className="text-3xl font-semibold">{profile.user.name}</h1>
          {profile.user.rank && (
            <div className="text-sm text-zinc-500 mt-1">{profile.user.rank} Barber</div>
          )}
          {profile.bio && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-3">{profile.bio}</p>
          )}
        </div>

        {profile.services.length === 0 ? (
          <p className="text-sm text-zinc-500 italic">
            No active services right now. Check back later.
          </p>
        ) : (
          <BookingForm
            slug={profile.slug}
            services={profile.services.map((s) => ({
              id: s.id,
              name: s.name,
              durationMin: s.durationMin,
              priceCents: s.priceCents,
            }))}
            dayOptions={dayOptions}
          />
        )}
      </div>
    </main>
  );
}
