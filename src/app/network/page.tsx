import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { walkDownline, walkUpline, countDownline } from "@/lib/network";
import { NetworkTree } from "@/components/network-tree";
import { CopyLinkButton } from "@/components/copy-link-button";

export default async function NetworkPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin?callbackUrl=/network");
  }

  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, referralCode: true },
  });
  if (!me) redirect("/signin");

  const [upline, downline] = await Promise.all([
    walkUpline(me.id, 7),
    walkDownline(me.id, 5),
  ]);

  const downlineCount = countDownline(downline);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const referralLink = `${appUrl}/signup?ref=${me.referralCode}`;

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/" className="text-sm text-zinc-500 hover:underline">← Back</Link>
            <h1 className="text-2xl font-semibold mt-1">Your network</h1>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 mb-6">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase text-zinc-500">Referral link</span>
            <CopyLinkButton value={referralLink} />
          </div>
          <div className="font-mono text-sm break-all">{referralLink}</div>
        </div>

        <section className="mb-8">
          <h2 className="text-sm uppercase text-zinc-500 mb-3">Upline ({upline.length})</h2>
          {upline.length === 0 ? (
            <p className="text-sm text-zinc-500 italic">You&apos;re at the top of the network.</p>
          ) : (
            <ul className="space-y-1.5">
              {upline.map((u) => (
                <li key={u.userId} className="flex items-center gap-2 py-1.5 px-2">
                  <span className="text-xs font-mono text-zinc-400">L{u.level}</span>
                  <span className="font-medium">{u.name}</span>
                  <span className="text-xs font-mono text-zinc-500">{u.referralCode}</span>
                  {u.rank && <span className="text-xs text-zinc-500">· {u.rank}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-sm uppercase text-zinc-500 mb-3">
            Downline ({downlineCount})
          </h2>
          <NetworkTree nodes={downline} />
        </section>
      </div>
    </main>
  );
}
