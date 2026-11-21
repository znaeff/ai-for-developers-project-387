import { Button } from '@/components/ui/button'
import type { Booking, MeetingType } from '@/lib/api'
import { formatMoscowDay, formatMoscowTime } from '@/lib/format'

type BookingListProps = {
  bookings: Booking[]
  meetingTypes: MeetingType[]
  isLoading: boolean
  loadError: string | null
  onRefresh: () => void
}

export function BookingList({
  bookings,
  meetingTypes,
  isLoading,
  loadError,
  onRefresh,
}: BookingListProps) {
  function resolveMeetingTypeTitle(meetingTypeId: string): string {
    return (
      meetingTypes.find((meetingType) => meetingType.id === meetingTypeId)?.title ??
      'Тип встречи'
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Брони</h2>
        <Button
          disabled={isLoading}
          onClick={onRefresh}
          type="button"
          variant="outline"
        >
          Обновить
        </Button>
      </div>

      {isLoading ? <p className="text-muted-foreground">Загрузка броней…</p> : null}

      {loadError ? (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      ) : null}

      {!isLoading && !loadError && bookings.length === 0 ? (
        <p className="text-muted-foreground">Пока нет предстоящих встреч.</p>
      ) : null}

      {bookings.length > 0 ? (
        <ul className="space-y-3" data-testid="booking-list">
          {bookings.map((booking) => (
            <li
              className="space-y-2 rounded-lg border border-border p-4"
              data-testid="booking"
              key={booking.id}
            >
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-medium">
                  {resolveMeetingTypeTitle(booking.meetingTypeId)}
                </h3>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {formatMoscowDay(booking.startsAt)},{' '}
                  {formatMoscowTime(booking.startsAt)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {booking.guestName}, {booking.guestEmail}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
