import type { MeetingType } from './meeting-types.js'

export type Slot = {
  startsAt: string
  endsAt: string
  isAvailable: boolean
}

export type TimeInterval = {
  startsAtMs: number
  endsAtMs: number
}

export function intervalsOverlap(
  left: TimeInterval,
  right: TimeInterval,
): boolean {
  return left.startsAtMs < right.endsAtMs && right.startsAtMs < left.endsAtMs
}

const MOSCOW_OFFSET_MINUTES = 3 * 60
const MOSCOW_OFFSET_MS = MOSCOW_OFFSET_MINUTES * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS = 14
const WORKDAY_START_MINUTES = 9 * 60
const WORKDAY_END_MINUTES = 18 * 60
const SLOT_STEP_MINUTES = 15

export function generateSlots(
  meetingType: MeetingType,
  now: Date,
  busy: TimeInterval[] = [],
): Slot[] {
  const nowMs = now.getTime()
  const windowEndMs = nowMs + WINDOW_DAYS * DAY_MS
  const localNow = new Date(nowMs + MOSCOW_OFFSET_MS)
  const firstLocalDayMs = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  )
  const slots: Slot[] = []

  for (let dayOffset = 0; dayOffset <= WINDOW_DAYS; dayOffset += 1) {
    const localDayMs = firstLocalDayMs + dayOffset * DAY_MS
    const weekday = new Date(localDayMs).getUTCDay()

    if (weekday === 0 || weekday === 6) {
      continue
    }

    for (
      let startMinutes = WORKDAY_START_MINUTES;
      startMinutes + meetingType.durationMinutes <= WORKDAY_END_MINUTES;
      startMinutes += SLOT_STEP_MINUTES
    ) {
      const startsAtMs =
        localDayMs - MOSCOW_OFFSET_MS + startMinutes * 60 * 1000
      if (startsAtMs <= nowMs || startsAtMs >= windowEndMs) {
        continue
      }

      const endsAtMs = startsAtMs + meetingType.durationMinutes * 60 * 1000
      const candidate = { startsAtMs, endsAtMs }
      const isAvailable = !busy.some((interval) =>
        intervalsOverlap(candidate, interval),
      )

      slots.push({
        startsAt: formatMoscowIso(startsAtMs),
        endsAt: formatMoscowIso(endsAtMs),
        isAvailable,
      })
    }
  }

  return slots
}

function formatMoscowIso(timestampMs: number): string {
  const local = new Date(timestampMs + MOSCOW_OFFSET_MS)
  const pad = (value: number) => String(value).padStart(2, '0')

  return [
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00`,
    '+03:00',
  ].join('')
}
