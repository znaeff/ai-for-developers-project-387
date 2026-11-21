import type { Booking, MeetingType } from '@/lib/api'
import { formatMoscowDay, formatMoscowTime } from '@/lib/format'

type BookingConfirmationProps = {
  booking: Booking
  meetingType: MeetingType
}

export function BookingConfirmation({
  booking,
  meetingType,
}: BookingConfirmationProps) {
  const endsAt = new Date(
    Date.parse(booking.startsAt) + meetingType.durationMinutes * 60 * 1000,
  ).toISOString()

  return (
    <section
      className="space-y-2 rounded-lg border border-border bg-muted/40 p-4"
      data-testid="booking-confirmation"
      role="status"
    >
      <h2 className="text-lg font-semibold">Встреча забронирована</h2>
      <p className="text-sm">
        {meetingType.title}: {formatMoscowDay(booking.startsAt)},{' '}
        {formatMoscowTime(booking.startsAt)}–{formatMoscowTime(endsAt)}
      </p>
      <p className="text-sm text-muted-foreground">
        {booking.guestName}, {booking.guestEmail}
      </p>
    </section>
  )
}
