import Link from "next/link";
import { format } from "date-fns";
import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { CopyLinkButton } from "@/components/copy-link-button";
import { becomeBarberAction, cancelBookingAction } from "./barber/actions";

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <h1 className="text-3xl font-semibold mb-2">DBU POC</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mb-8">
            Booking + network + commission platform.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              href="/signin"
              className="px-5 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:opacity-90 transition"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="px-5 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
            >
              Sign up
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const [user, myBookings] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      include: {
        sponsor: { select: { name: true, referralCode: true } },
        barberProfile: { select: { slug: true } },
        _count: { select: { sponsees: true } },
      },
    }),
    db.booking.findMany({
      where: {
        clientId: session.user.id,
        status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { gte: new Date() },
      },
      include: {
        barber: { select: { name: true } },
        service: { select: { name: true, durationMin: true } },
      },
      orderBy: { startAt: "asc" },
      take: 10,
    }),
  ]);

  if (!user) {
    return null;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const referralLink = `${appUrl}/signup?ref=${user.referralCode}`;

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Hi, {user.name}</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {user.email} · <span className="font-mono">{user.role}</span>
              {user.rank && <> · <span className="font-mono">{user.rank}</span></>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {user.role === "ADMIN" && (
              <Link
                href="/admin"
                className="text-sm underline text-zinc-600 dark:text-zinc-400"
              >
                Admin
              </Link>
            )}
            <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
              <button className="text-sm underline text-zinc-600 dark:text-zinc-400">
                Sign out
              </button>
            </form>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mb-8">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase text-zinc-500">Your referral code</span>
              <CopyLinkButton value={referralLink} label="Copy link" />
            </div>
            <div className="font-mono text-xl mb-2">{user.referralCode}</div>
            <Link href="/network" className="text-xs text-zinc-500 underline">
              View network tree →
            </Link>
          </div>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="text-xs uppercase text-zinc-500 mb-1">Sponsor</div>
            <div className="text-sm">
              {user.sponsor ? (
                <>
                  {user.sponsor.name} <span className="font-mono text-zinc-500">({user.sponsor.referralCode})</span>
                </>
              ) : (
                <span className="text-zinc-500">— (top-level)</span>
              )}
            </div>
            <div className="text-xs text-zinc-500 mt-2">
              {user._count.sponsees} direct sponsees
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 mb-4">
          <div className="text-xs uppercase text-zinc-500 mb-2">Barber</div>
          {user.barberProfile ? (
            <div className="space-y-1">
              <Link
                href="/barber"
                className="inline-block text-sm underline text-zinc-900 dark:text-zinc-100"
              >
                Open barber dashboard →
              </Link>
              <div className="text-xs text-zinc-500">
                Public booking link:{" "}
                <Link href={`/book/${user.barberProfile.slug}`} className="underline">
                  /book/{user.barberProfile.slug}
                </Link>
              </div>
            </div>
          ) : (
            <form action={becomeBarberAction}>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                Offer services and accept bookings through the platform.
              </p>
              <button
                type="submit"
                className="text-sm px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition"
              >
                Become a barber
              </button>
            </form>
          )}
        </div>

        {myBookings.length > 0 && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="text-xs uppercase text-zinc-500 mb-3">
              Your upcoming bookings ({myBookings.length})
            </div>
            <ul className="space-y-1.5">
              {myBookings.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between py-2 px-3 rounded-md bg-zinc-50 dark:bg-zinc-900 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {b.service.name} with {b.barber.name}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {format(b.startAt, "EEE, MMM d · h:mm a")} · {b.service.durationMin} min
                    </div>
                  </div>
                  <span
                    className={`text-xs font-mono ${
                      b.status === "CONFIRMED"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {b.status}
                  </span>
                  <form action={cancelBookingAction}>
                    <input type="hidden" name="bookingId" value={b.id} />
                    <button
                      type="submit"
                      className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-red-50 dark:hover:bg-red-950/50 hover:border-red-300 dark:hover:border-red-900 hover:text-red-700 dark:hover:text-red-300 transition"
                    >
                      Cancel
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
