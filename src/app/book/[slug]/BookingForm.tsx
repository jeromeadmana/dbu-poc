"use client";

import { useEffect, useState, useTransition } from "react";
import { format } from "date-fns";
import { createBookingCheckoutAction, getAvailableSlotsAction } from "./actions";

type Service = {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
};

type Props = {
  slug: string;
  services: Service[];
  dayOptions: { iso: string; label: string; sub: string }[];
};

export function BookingForm({ slug, services, dayOptions }: Props) {
  const [serviceId, setServiceId] = useState<string>(services[0]?.id ?? "");
  const [dayIso, setDayIso] = useState<string>(dayOptions[0]?.iso ?? "");
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [loadingSlots, startLoadingSlots] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!serviceId || !dayIso) return;
    setSelectedSlot("");
    setError("");
    startLoadingSlots(async () => {
      const next = await getAvailableSlotsAction(slug, serviceId, dayIso);
      setSlots(next);
    });
  }, [slug, serviceId, dayIso]);

  const selectedService = services.find((s) => s.id === serviceId);

  function handleBook() {
    if (!selectedSlot || !serviceId) return;
    setError("");
    startSubmit(async () => {
      const result = await createBookingCheckoutAction({
        slug,
        serviceId,
        startIso: selectedSlot,
      });
      if (result.ok) {
        window.location.href = result.checkoutUrl;
      } else if (result.redirectTo) {
        window.location.href = result.redirectTo;
      } else {
        setError(result.error ?? "Something went wrong");
      }
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs uppercase text-zinc-500 mb-2">1. Choose a service</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setServiceId(s.id)}
              className={`text-left p-3 rounded-lg border transition ${
                serviceId === s.id
                  ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900"
                  : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              <div className="font-medium">{s.name}</div>
              <div className="text-sm text-zinc-500">
                {s.durationMin} min · ${(s.priceCents / 100).toFixed(2)}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="text-xs uppercase text-zinc-500 mb-2">2. Pick a day</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {dayOptions.map((d) => (
            <button
              key={d.iso}
              type="button"
              onClick={() => setDayIso(d.iso)}
              className={`shrink-0 px-3 py-2 rounded-lg border text-center min-w-[72px] transition ${
                dayIso === d.iso
                  ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900"
                  : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              <div className="text-xs text-zinc-500">{d.sub}</div>
              <div className="font-medium">{d.label}</div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="text-xs uppercase text-zinc-500 mb-2">3. Pick a time</div>
        {loadingSlots ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : slots.length === 0 ? (
          <div className="text-sm text-zinc-500 italic">
            No available slots on this day. Try another day.
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {slots.map((iso) => {
              const d = new Date(iso);
              const active = selectedSlot === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedSlot(iso)}
                  className={`py-2 rounded border text-sm transition ${
                    active
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
                  }`}
                >
                  {format(d, "h:mm a")}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleBook}
        disabled={!selectedSlot || submitting}
        className="w-full py-3 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting
          ? "Creating checkout…"
          : selectedService && selectedSlot
            ? `Book for $${(selectedService.priceCents / 100).toFixed(2)}`
            : "Select a slot to continue"}
      </button>
    </div>
  );
}
