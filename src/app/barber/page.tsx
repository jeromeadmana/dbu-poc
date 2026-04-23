import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { CopyLinkButton } from "@/components/copy-link-button";
import { format } from "date-fns";
import { startMembershipAction } from "./actions";

export default async function BarberDashboard() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/barber");

  const profile = await db.barberProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      user: {
        select: {
          name: true,
          email: true,
          rank: true,
          stripeSubscriptionId: true,
          isSubscriptionWaived: true,
        },
      },
      services: { where: { isActive: true }, orderBy: { priceCents: "asc" } },
    },
  });

  if (!profile) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-xl font-semibold mb-2">No barber profile</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
            You&apos;re signed in but not registered as a barber yet.
          </p>
          <Link href="/" className="underline text-sm">Back home</Link>
        </div>
      </main>
    );
  }

  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const [todayBookings, upcomingBookings] = await Promise.all([
    db.booking.findMany({
      where: {
        barberId: profile.userId,
        status: { in: ["CONFIRMED", "PENDING"] },
        startAt: { gte: now, lte: endOfToday },
      },
      include: { client: { select: { name: true, email: true } }, service: true },
      orderBy: { startAt: "asc" },
    }),
    db.booking.findMany({
      where: {
        barberId: profile.userId,
        status: "CONFIRMED",
        startAt: { gt: endOfToday },
      },
      take: 20,
      include: { client: { select: { name: true, email: true } }, service: true },
      orderBy: { startAt: "asc" },
    }),
  ]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const bookingLink = `${appUrl}/book/${profile.slug}`;

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:underline">← Home</Link>
            <h1 className="text-2xl font-semibold mt-1">
              {profile.user.name}
              <span className="ml-2 text-sm font-normal text-zinc-500">· {profile.user.rank}</span>
            </h1>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 mb-6">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase text-zinc-500">Your public booking link</span>
            <CopyLinkButton value={bookingLink} />
          </div>
          <Link href={`/book/${profile.slug}`} className="font-mono text-sm break-all underline">
            {bookingLink}
          </Link>
        </div>

        <section className="mb-6">
          <h2 className="text-sm uppercase text-zinc-500 mb-3">Membership</h2>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            {profile.user.isSubscriptionWaived ? (
              <div>
                <div className="text-emerald-700 dark:text-emerald-400 font-medium mb-1">
                  Waived — free app unlocked
                </div>
                <p className="text-xs text-zinc-500">
                  You have 3+ active referrals. Subscription billing is waived while that holds.
                </p>
              </div>
            ) : profile.user.stripeSubscriptionId ? (
              <div>
                <div className="text-emerald-700 dark:text-emerald-400 font-medium mb-1">
                  Active
                </div>
                <p className="text-xs text-zinc-500">
                  Each renewal distributes commission up your sponsor chain.
                </p>
              </div>
            ) : (
              <form action={startMembershipAction}>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                  Subscribe for $29/month. Each payment distributes commission up your sponsor
                  chain (and is waived once you have 3 active referrals).
                </p>
                <button
                  type="submit"
                  className="text-sm px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition"
                >
                  Start membership
                </button>
              </form>
            )}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-sm uppercase text-zinc-500 mb-3">Services</h2>
          <ul className="space-y-1.5">
            {profile.services.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-zinc-50 dark:bg-zinc-900">
                <span className="font-medium">{s.name}</span>
                <span className="text-sm text-zinc-500">
                  {s.durationMin} min · ${(s.priceCents / 100).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-sm uppercase text-zinc-500 mb-3">
            Today ({todayBookings.length})
          </h2>
          {todayBookings.length === 0 ? (
            <p className="text-sm text-zinc-500 italic">Nothing scheduled for today.</p>
          ) : (
            <ul className="space-y-1.5">
              {todayBookings.map((b) => (
                <BookingRow key={b.id} booking={b} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-sm uppercase text-zinc-500 mb-3">
            Upcoming ({upcomingBookings.length})
          </h2>
          {upcomingBookings.length === 0 ? (
            <p className="text-sm text-zinc-500 italic">No upcoming bookings.</p>
          ) : (
            <ul className="space-y-1.5">
              {upcomingBookings.map((b) => (
                <BookingRow key={b.id} booking={b} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function BookingRow({
  booking,
}: {
  booking: {
    id: string;
    startAt: Date;
    status: string;
    service: { name: string; durationMin: number; priceCents: number };
    client: { name: string; email: string };
  };
}) {
  const statusColor =
    booking.status === "CONFIRMED"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";
  return (
    <li className="flex items-center justify-between py-2 px-3 rounded-md border border-zinc-200 dark:border-zinc-800">
      <div>
        <div className="font-medium">{booking.client.name}</div>
        <div className="text-xs text-zinc-500">
          {booking.service.name} · {booking.service.durationMin} min
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm">{format(booking.startAt, "MMM d, h:mm a")}</div>
        <div className={`text-xs ${statusColor}`}>{booking.status}</div>
      </div>
    </li>
  );
}
