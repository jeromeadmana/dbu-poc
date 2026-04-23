import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { format } from "date-fns";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  clearFlashAction,
  recomputeWaiverAction,
  releaseCommissionsAction,
  resetUserPasswordAction,
  updateUserAction,
} from "./actions";

type Flash =
  | { kind: "password-reset"; email: string; name: string; tempPw: string };

const RANKS = ["MEMBER", "PRO", "ELITE", "COACH", "DYNASTY"] as const;
const ROLES = ["CLIENT", "BARBER", "ADMIN"] as const;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/signin?callbackUrl=/admin");
  }
  const { ok, error } = await searchParams;

  let flash: Flash | null = null;
  const flashCookie = (await cookies()).get("dbu_admin_flash");
  if (flashCookie) {
    try {
      flash = JSON.parse(flashCookie.value) as Flash;
    } catch {
      flash = null;
    }
  }

  const now = new Date();

  const [
    userGrouped,
    pendingAgg,
    approvedAgg,
    paymentAgg,
    bookingCount,
    releasableCount,
    users,
    commissions,
    webhooks,
  ] = await Promise.all([
    db.user.groupBy({ by: ["role"], _count: { _all: true } }),
    db.commission.aggregate({ where: { status: "PENDING" }, _sum: { amountCents: true }, _count: true }),
    db.commission.aggregate({ where: { status: "APPROVED" }, _sum: { amountCents: true }, _count: true }),
    db.payment.aggregate({ where: { status: "SUCCEEDED" }, _sum: { amountCents: true }, _count: true }),
    db.booking.count(),
    db.commission.count({ where: { status: "PENDING", releaseAt: { lte: now } } }),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        sponsor: { select: { name: true, referralCode: true } },
        _count: { select: { sponsees: true, commissionsReceived: true } },
      },
    }),
    db.commission.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        beneficiary: { select: { name: true, referralCode: true } },
        payer: { select: { name: true, referralCode: true } },
      },
    }),
    db.webhookEvent.findMany({
      orderBy: { processedAt: "desc" },
      take: 20,
    }),
  ]);

  const byRole: Record<string, number> = {};
  for (const row of userGrouped) byRole[row.role] = row._count._all;

  return (
    <main className="min-h-screen px-4 py-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:underline">← Home</Link>
            <h1 className="text-2xl font-semibold mt-1">Admin</h1>
            <p className="text-sm text-zinc-500">Signed in as {session.user.email}</p>
          </div>
        </div>

        {ok && (
          <div className="mb-4 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {ok}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {flash?.kind === "password-reset" && (
          <div className="mb-4 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-amber-900 dark:text-amber-200 mb-1">
                  Temporary password generated
                </div>
                <div className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                  Share with {flash.name} ({flash.email}) and ask them to change it after signing in. This banner
                  auto-expires in 5 min or when dismissed.
                </div>
                <code className="inline-block text-sm font-mono bg-white dark:bg-zinc-950 border border-amber-300 dark:border-amber-800 px-2 py-1 rounded select-all">
                  {flash.tempPw}
                </code>
              </div>
              <form action={clearFlashAction}>
                <button
                  type="submit"
                  className="text-xs underline text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100"
                >
                  Dismiss
                </button>
              </form>
            </div>
          </div>
        )}

        <div className="mb-4 rounded-md bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
          Note: role / rank changes here take effect in the DB immediately, but the affected
          user&apos;s JWT still carries the <em>old</em> role until they sign out and back in.
          Ask them to re-login after promoting them.
        </div>

        {/* Stats */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <StatCard
            label="Users"
            value={(userGrouped.reduce((s, r) => s + r._count._all, 0)).toString()}
            sub={`${byRole.BARBER ?? 0} barbers · ${byRole.CLIENT ?? 0} clients · ${byRole.ADMIN ?? 0} admin`}
          />
          <StatCard
            label="Bookings"
            value={bookingCount.toString()}
          />
          <StatCard
            label="Payments · SUCCEEDED"
            value={`$${((paymentAgg._sum.amountCents ?? 0) / 100).toFixed(2)}`}
            sub={`${paymentAgg._count} payments`}
          />
          <StatCard
            label="Commissions"
            value={`$${(((pendingAgg._sum.amountCents ?? 0) + (approvedAgg._sum.amountCents ?? 0)) / 100).toFixed(2)}`}
            sub={`${pendingAgg._count} pending · ${approvedAgg._count} approved`}
          />
        </section>

        {/* Release action */}
        <section className="mb-8 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <h2 className="text-sm uppercase text-zinc-500 mb-2">Commission release</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
            {releasableCount > 0 ? (
              <>
                <strong>{releasableCount}</strong> commission
                {releasableCount === 1 ? "" : "s"} eligible for release
                (PENDING &middot; releaseAt has passed).
              </>
            ) : (
              <>No commissions ready to release right now.</>
            )}
          </p>
          <form action={releaseCommissionsAction}>
            <button
              type="submit"
              disabled={releasableCount === 0}
              className="text-sm px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Release eligible commissions
            </button>
          </form>
        </section>

        {/* Users */}
        <section className="mb-8">
          <h2 className="text-sm uppercase text-zinc-500 mb-3">
            Users ({users.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2">Ref / sponsor</th>
                  <th className="text-left px-3 py-2">Flags</th>
                  <th className="text-left px-3 py-2">Stats</th>
                  <th className="text-left px-3 py-2">Update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {users.map((u) => (
                  <tr key={u.id} className="align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-zinc-500">{u.email}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-mono">{u.referralCode}</div>
                      <div className="text-zinc-500 mt-0.5">
                        {u.sponsor ? <>↑ {u.sponsor.name} <span className="font-mono">({u.sponsor.referralCode})</span></> : "top-level"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs space-y-0.5">
                      {u.hasFirstPayment && <div className="text-emerald-600 dark:text-emerald-400">✓ first payment</div>}
                      {u.isSubscriptionWaived && <div className="text-amber-600 dark:text-amber-400">✓ waived</div>}
                      {!u.hasFirstPayment && !u.isSubscriptionWaived && <div className="text-zinc-400">—</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      <div>{u._count.sponsees} sponsees</div>
                      <div>{u._count.commissionsReceived} commissions</div>
                    </td>
                    <td className="px-3 py-2">
                      <form action={updateUserAction} className="flex items-center gap-1.5 flex-wrap">
                        <input type="hidden" name="userId" value={u.id} />
                        <select
                          name="role"
                          defaultValue={u.role}
                          disabled={u.id === session.user.id}
                          className="text-xs border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-1.5 py-1 disabled:opacity-60"
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <select
                          name="rank"
                          defaultValue={u.rank ?? "MEMBER"}
                          className="text-xs border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-1.5 py-1"
                        >
                          {RANKS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <button
                          type="submit"
                          className="text-xs px-2 py-1 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90"
                        >
                          Save
                        </button>
                      </form>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        {u.role === "BARBER" && u._count.sponsees > 0 && (
                          <form action={recomputeWaiverAction}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              className="text-xs underline text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                            >
                              Recompute waiver
                            </button>
                          </form>
                        )}
                        {u.id !== session.user.id && (
                          <form action={resetUserPasswordAction}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              className="text-xs underline text-zinc-500 hover:text-red-700 dark:hover:text-red-300"
                            >
                              Reset password
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Commissions */}
        <section className="mb-8">
          <h2 className="text-sm uppercase text-zinc-500 mb-3">
            Recent commissions ({commissions.length})
          </h2>
          {commissions.length === 0 ? (
            <p className="text-sm text-zinc-500 italic">No commissions yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="text-left px-3 py-2">When</th>
                    <th className="text-left px-3 py-2">Payer</th>
                    <th className="text-left px-3 py-2">Beneficiary</th>
                    <th className="text-left px-3 py-2">Level / rank</th>
                    <th className="text-right px-3 py-2">Amount</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-left px-3 py-2">Release</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {commissions.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {format(c.createdAt, "MMM d, HH:mm")}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {c.payer.name}
                        <div className="font-mono text-zinc-500">{c.payer.referralCode}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {c.beneficiary.name}
                        <div className="font-mono text-zinc-500">{c.beneficiary.referralCode}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        L{c.level} · <span className="text-zinc-500">{c.rankAtPayout}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        ${(c.amountCents / 100).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <StatusPill status={c.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {c.status === "PENDING" ? format(c.releaseAt, "MMM d") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Webhooks */}
        <section>
          <h2 className="text-sm uppercase text-zinc-500 mb-3">
            Recent webhook events
          </h2>
          {webhooks.length === 0 ? (
            <p className="text-sm text-zinc-500 italic">No webhook events yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="text-left px-3 py-2">When</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Stripe event id</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {webhooks.map((w) => (
                    <tr key={w.id}>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {format(w.processedAt, "MMM d, HH:mm:ss")}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="font-mono">{w.type}</span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-zinc-500">{w.stripeEventId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-xs uppercase text-zinc-500 mb-1">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "APPROVED"
      ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
      : status === "PENDING"
        ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300";
  return <span className={`px-2 py-0.5 rounded ${cls} font-mono text-xs`}>{status}</span>;
}
