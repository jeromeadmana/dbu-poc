import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getBarberStats } from "@/lib/barber-stats";
import { evaluateUnlockRule, parseUnlockRule } from "@/lib/courses";

export default async function CoursesPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/courses");

  const [user, modules] = await Promise.all([
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        role: true,
        rank: true,
        barberProfile: { select: { userId: true, capacityTargetHrs: true } },
      },
    }),
    db.courseModule.findMany({ orderBy: { orderIndex: "asc" } }),
  ]);
  if (!user) redirect("/signin");

  const progressRows = await db.courseProgress.findMany({
    where: { userId: session.user.id },
    select: { moduleId: true, completedAt: true },
  });
  const completedByModule = new Map(
    progressRows.filter((p) => p.completedAt).map((p) => [p.moduleId, p.completedAt as Date]),
  );

  let capacityPct = 0;
  if (user.barberProfile) {
    const stats = await getBarberStats(user.barberProfile.userId, user.barberProfile.capacityTargetHrs);
    capacityPct = stats.capacity.pct;
  }

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-sm text-zinc-500 hover:underline">← Home</Link>
        <h1 className="text-2xl font-semibold mt-1 mb-1">Courses</h1>
        <p className="text-sm text-zinc-500 mb-6">
          {user.rank ? <>Your rank: <span className="font-mono">{user.rank}</span> · capacity: {Math.round(capacityPct)}%</> : "Become a barber to unlock more modules."}
        </p>

        {modules.length === 0 ? (
          <p className="text-sm text-zinc-500 italic">No course modules seeded yet.</p>
        ) : (
          <ul className="space-y-3">
            {modules.map((m) => {
              const completedAt = completedByModule.get(m.id);
              const verdict = evaluateUnlockRule(parseUnlockRule(m.unlockRule), {
                role: user.role,
                rank: user.rank,
                capacityPct,
              });
              const unlocked = verdict.unlocked;
              return (
                <li key={m.id} className={`rounded-lg border p-4 ${unlocked ? "border-zinc-200 dark:border-zinc-800" : "border-zinc-200 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-950/50"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {unlocked ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                            Unlocked
                          </span>
                        ) : (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                            Locked
                          </span>
                        )}
                        {completedAt && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                            ✓ Completed
                          </span>
                        )}
                      </div>
                      <h2 className="font-semibold mt-1.5">{m.title}</h2>
                      {m.description && (
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                          {m.description}
                        </p>
                      )}
                      {!unlocked && "reason" in verdict && (
                        <p className="text-xs text-zinc-500 mt-2 italic">
                          {verdict.reason}
                        </p>
                      )}
                    </div>
                    <div>
                      {unlocked ? (
                        <Link
                          href={`/courses/${m.id}`}
                          className="inline-block text-sm px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition whitespace-nowrap"
                        >
                          {completedAt ? "Review" : "Open"}
                        </Link>
                      ) : (
                        <button
                          disabled
                          className="inline-block text-sm px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-500 opacity-60 cursor-not-allowed whitespace-nowrap"
                        >
                          Locked
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
