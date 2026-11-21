import { randomUUID } from 'node:crypto'
import type { MeetingType, MeetingTypeStore } from './meeting-types.js'
import {
  generateSlots,
  intervalsOverlap,
  type TimeInterval,
} from './slots.js'

export type Booking = {
  id: string
  meetingTypeId: string
  startsAt: string
  guestName: string
  guestEmail: string
  createdAt: string
}

export type BookingInput = Pick<
  Booking,
  'meetingTypeId' | 'startsAt' | 'guestName' | 'guestEmail'
>

export type BookingValidation =
  | { ok: true; value: BookingInput }
  | { ok: false; error: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseBookingInput(input: unknown): BookingValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'Ожидается объект с данными брони' }
  }

  const { meetingTypeId, startsAt, guestName, guestEmail } = input as Record<
    string,
    unknown
  >

  if (typeof meetingTypeId !== 'string' || meetingTypeId.trim() === '') {
    return { ok: false, error: 'Тип встречи обязателен' }
  }

  if (typeof startsAt !== 'string' || Number.isNaN(Date.parse(startsAt))) {
    return { ok: false, error: 'Начало встречи обязательно и должно быть датой' }
  }

  if (typeof guestName !== 'string' || guestName.trim() === '') {
    return { ok: false, error: 'Имя обязательно' }
  }

  if (typeof guestEmail !== 'string' || guestEmail.trim() === '') {
    return { ok: false, error: 'Почта обязательна' }
  }

  const trimmedEmail = guestEmail.trim()
  if (!EMAIL_PATTERN.test(trimmedEmail)) {
    return { ok: false, error: 'Почта должна быть корректным email-адресом' }
  }

  return {
    ok: true,
    value: {
      meetingTypeId,
      startsAt,
      guestName: guestName.trim(),
      guestEmail: trimmedEmail,
    },
  }
}

export type BookingCreation =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'invalid-slot' | 'conflict' }

export type BookingStore = {
  list(): Booking[]
  create(
    meetingType: MeetingType,
    input: BookingInput,
    now: Date,
  ): BookingCreation
  clear(): void
}

export function createBookingStore(
  meetingTypes: MeetingTypeStore,
): BookingStore {
  const bookings: Booking[] = []

  return {
    list() {
      return [...bookings].sort(
        (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
      )
    },
    create(meetingType, input, now) {
      // Everything below runs synchronously, so the availability check and the
      // insert cannot interleave with another request in this process.
      const startsAtMs = Date.parse(input.startsAt)
      const slot = generateSlots(meetingType, now).find(
        (candidate) => Date.parse(candidate.startsAt) === startsAtMs,
      )
      if (!slot) {
        return { ok: false, reason: 'invalid-slot' }
      }

      const endsAtMs = startsAtMs + meetingType.durationMinutes * 60 * 1000
      const candidate = { startsAtMs, endsAtMs }
      const busy = busyIntervals(bookings, meetingTypes)
      if (busy.some((interval) => intervalsOverlap(candidate, interval))) {
        return { ok: false, reason: 'conflict' }
      }

      const booking: Booking = {
        id: randomUUID(),
        meetingTypeId: meetingType.id,
        startsAt: slot.startsAt,
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        createdAt: now.toISOString(),
      }
      bookings.push(booking)
      return { ok: true, booking }
    },
    clear() {
      bookings.length = 0
    },
  }
}

export function busyIntervals(
  bookings: Booking[],
  meetingTypes: MeetingTypeStore,
): TimeInterval[] {
  return bookings.flatMap((booking) => {
    const meetingType = meetingTypes.find(booking.meetingTypeId)
    if (!meetingType) {
      return []
    }

    const startsAtMs = Date.parse(booking.startsAt)
    return [
      {
        startsAtMs,
        endsAtMs: startsAtMs + meetingType.durationMinutes * 60 * 1000,
      },
    ]
  })
}
