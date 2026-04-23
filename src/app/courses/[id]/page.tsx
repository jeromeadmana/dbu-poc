import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getBarberStats } from "@/lib/barber-stats";
import { evaluateUnlockRule, parseUnlockRule } from "@/lib/courses";
import { toggleCompleteAction } from "../actions";

function loomEmbedUrl(shareUrl: string): string | null {
  // Accepts "https://www.loom.com/share/<id>" or "<id>" → returns embed URL
  try {
    const match = shareUrl.match(/loom\.com\/share\/([a-f0-9]{8,})/i);
    if (match) return `https://www.loom.com/embed/${match[1]}`;
    if (shareUrl.match(/loom\.com\/embed\//)) return shareUrl;
    if (/^[a-f0-9]{8,}$/i.test(shareUrl)) return `https://www.loom.com/embed/${shareUrl}`;
  } catch {
    /* fall through */
  }
  return null;
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/signin?callbackUrl=/courses/${id}`);

  const [mod, user] = await Promise.all([
    db.courseModule.findUnique({ where: { id } }),
    db.user.findUnique({
      where: { id: session.user.id },
      select: {
        role: true,
        rank: true,
        barberProfile: { select: { userId: true, capacityTargetHrs: true } },
      },
    }),
  ]);
  if (!mod) notFound();
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

  const progress = await db.courseProgress.findUnique({
    where: { userId_moduleId: { userId: session.user.id, moduleId: mod.id } },
  });
  const completedAt = progress?.completedAt ?? null;

  const embed = loomEmbedUrl(mod.loomUrl);

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <Link href="/courses" className="text-sm text-zinc-500 hover:underline">← Courses</Link>
        <h1 className="text-2xl font-semibold mt-1">{mod.title}</h1>
        {mod.description && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 mb-4">{mod.description}</p>
        )}

        {!verdict.unlocked ? (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-6 text-center bg-zinc-50/50 dark:bg-zinc-950/50">
            <div className="text-xl mb-1">🔒</div>
            <div className="font-medium">This module is locked</div>
            <p className="text-sm text-zinc-500 mt-1">
              {"reason" in verdict ? verdict.reason : "Not unlocked for your current state."}
            </p>
          </div>
        ) : (
          <>
            {embed ? (
              <div className="aspect-video rounded-lg overflow-hidden bg-black mb-4">
                <iframe
                  src={embed}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4 mb-4 text-sm text-amber-700 dark:text-amber-300">
                Could not embed the configured video URL. Raw:{" "}
                <a href={mod.loomUrl} target="_blank" rel="noopener" className="underline">
                  {mod.loomUrl}
                </a>
              </div>
            )}

            <form action={toggleCompleteAction} className="flex items-center gap-3">
              <input type="hidden" name="moduleId" value={mod.id} />
              <button
                type="submit"
                className={`text-sm px-3 py-1.5 rounded-md transition ${
                  completedAt
                    ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-700"
                    : "bg-emerald-600 dark:bg-emerald-500 text-white hover:bg-emerald-700 dark:hover:bg-emerald-400"
                }`}
              >
                {completedAt ? "Mark as not completed" : "Mark complete"}
              </button>
              {completedAt && (
                <span className="text-xs text-zinc-500">
                  Completed {format(completedAt, "MMM d, yyyy")}
                </span>
              )}
            </form>
          </>
        )}
      </div>
    </main>
  );
}
