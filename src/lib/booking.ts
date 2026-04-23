import { addMinutes, isAfter, isBefore, set, startOfDay } from "date-fns";

export type AvailabilityIntervals = Array<[string, string]>; // [["09:00", "17:00"], ...]

export type WeeklyAvailability = {
  mon: AvailabilityIntervals;
  tue: AvailabilityIntervals;
  wed: AvailabilityIntervals;
  thu: AvailabilityIntervals;
  fri: AvailabilityIntervals;
  sat: AvailabilityIntervals;
  sun: AvailabilityIntervals;
};

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DEFAULT_AVAILABILITY: WeeklyAvailability = {
  mon: [["09:00", "17:00"]],
  tue: [["09:00", "17:00"]],
  wed: [["09:00", "17:00"]],
  thu: [["09:00", "17:00"]],
  fri: [["09:00", "17:00"]],
  sat: [],
  sun: [],
};

/** Slot start-time granularity (minutes). Slots begin on 15-min boundaries. */
export const SLOT_STEP_MIN = 15;

export interface Booking {
  startAt: Date;
  endAt: Date;
}

/**
 * Given a barber's weekly schedule, a service duration, and existing bookings
 * for a specific calendar day, return the valid start times for a new booking.
 *
 * - Slots start on 15-min boundaries within each availability interval.
 * - `slot + duration` must fit inside the availability interval.
 * - Slots in the past (relative to `now`) are filtered out.
 * - Slots overlapping any existing booking are filtered out.
 */
export function generateSlots(params: {
  day: Date;
  availability: WeeklyAvailability;
  serviceDurationMin: number;
  existingBookings: Booking[];
  now?: Date;
}): Date[] {
  const { day, availability, serviceDurationMin, existingBookings, now = new Date() } = params;
  const dayKey = DAY_KEYS[day.getDay()] as DayKey;
  const intervals = availability[dayKey] ?? [];
  const slots: Date[] = [];

  for (const [startStr, endStr] of intervals) {
    const [sh, sm] = startStr.split(":").map(Number);
    const [eh, em] = endStr.split(":").map(Number);
    const intervalStart = set(day, { hours: sh, minutes: sm, seconds: 0, milliseconds: 0 });
    const intervalEnd = set(day, { hours: eh, minutes: em, seconds: 0, milliseconds: 0 });

    let slotStart = intervalStart;
    while (true) {
      const slotEnd = addMinutes(slotStart, serviceDurationMin);
      if (isAfter(slotEnd, intervalEnd)) break;

      const isPast = isBefore(slotStart, now);
      const overlapsExisting = existingBookings.some(
        (b) => isBefore(slotStart, b.endAt) && isBefore(b.startAt, slotEnd),
      );

      if (!isPast && !overlapsExisting) {
        slots.push(slotStart);
      }
      slotStart = addMinutes(slotStart, SLOT_STEP_MIN);
    }
  }
  return slots;
}

export function dayBoundsUtc(day: Date): { start: Date; end: Date } {
  const start = startOfDay(day);
  const end = addMinutes(start, 24 * 60);
  return { start, end };
}

/** Build a URL-safe, user-recognizable slug for a barber. */
export function makeBarberSlug(name: string, referralCode: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const suffix = referralCode.toLowerCase();
  return base ? `${base}-${suffix}` : suffix;
}
