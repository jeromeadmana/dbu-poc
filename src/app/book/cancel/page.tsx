import Link from "next/link";
import { db } from "@/lib/db";

export default async function BookingCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking: bookingId } = await searchParams;

  // If the booking is still pending, mark it cancelled so the slot frees up.
  if (bookingId) {
    await db.booking
      .updateMany({
        where: { id: bookingId, status: "PENDING" },
        data: { status: "CANCELLED" },
      })
      .catch(() => {
        /* best-effort; ignore if booking doesn't exist */
      });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <h1 className="text-xl font-semibold mb-1">Checkout cancelled</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
          The slot was released. You can try again anytime.
        </p>
        <Link
          href="/"
          className="inline-block text-sm underline text-zinc-600 dark:text-zinc-400"
        >
          Back home
        </Link>
      </div>
    </main>
  );
}
