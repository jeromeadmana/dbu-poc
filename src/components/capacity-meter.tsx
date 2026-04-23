export function CapacityMeter({
  pct,
  unlocked,
  bookedMin,
  targetMin,
  unlockThreshold,
}: {
  pct: number;
  unlocked: boolean;
  bookedMin: number;
  targetMin: number;
  unlockThreshold: number;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const barColor = unlocked
    ? "bg-emerald-500"
    : pct >= 60
      ? "bg-amber-500"
      : "bg-zinc-500";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-2xl font-semibold">{Math.round(pct)}%</div>
        <div className="text-xs text-zinc-500">
          {(bookedMin / 60).toFixed(1)}h booked of {(targetMin / 60).toFixed(0)}h weekly target
        </div>
      </div>
      <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden relative">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${clamped}%` }} />
        <div
          className="absolute top-0 bottom-0 w-px bg-zinc-400 dark:bg-zinc-600"
          style={{ left: `${unlockThreshold}%` }}
          aria-hidden
        />
      </div>
      <div className="flex items-center justify-between text-xs mt-1.5">
        <span className="text-zinc-500">
          Unlock threshold marker at {unlockThreshold}%
        </span>
        <span
          className={
            unlocked
              ? "text-emerald-600 dark:text-emerald-400 font-medium"
              : "text-zinc-500"
          }
        >
          {unlocked ? "✓ Price Raise course unlocked" : "Price Raise locked"}
        </span>
      </div>
    </div>
  );
}
