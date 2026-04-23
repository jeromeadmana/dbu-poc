import type { DownlineNode } from "@/lib/network";

const ROLE_BADGE: Record<string, string> = {
  ADMIN: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
  BARBER: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
  CLIENT: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
};

const RANK_BADGE: Record<string, string> = {
  MEMBER: "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200",
  PRO: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
  ELITE: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  COACH: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300",
  DYNASTY: "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",
};

export function NetworkTree({ nodes }: { nodes: DownlineNode[] }) {
  if (nodes.length === 0) {
    return (
      <div className="text-sm text-zinc-500 italic py-4">
        No one in your downline yet. Share your referral link above.
      </div>
    );
  }
  return <ul className="space-y-1.5">{nodes.map((n) => <NetworkNode key={n.userId} node={n} />)}</ul>;
}

function NetworkNode({ node }: { node: DownlineNode }) {
  return (
    <li>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
        <span className="text-xs font-mono text-zinc-400">L{node.level}</span>
        <span className="font-medium">{node.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_BADGE[node.role] ?? ROLE_BADGE.CLIENT}`}>
          {node.role}
        </span>
        {node.rank && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${RANK_BADGE[node.rank] ?? RANK_BADGE.MEMBER}`}>
            {node.rank}
          </span>
        )}
        <span className="text-xs font-mono text-zinc-500">{node.referralCode}</span>
        {!node.hasFirstPayment && (
          <span className="text-xs text-zinc-400 italic">(no payment yet)</span>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="ml-6 border-l border-zinc-200 dark:border-zinc-800 pl-3 mt-1">
          <ul className="space-y-1.5">
            {node.children.map((c) => <NetworkNode key={c.userId} node={c} />)}
          </ul>
        </div>
      )}
    </li>
  );
}
