import { useState, type FormEvent } from 'react'
import { inputClassName } from '@/components/formStyles'
import { Button } from '@/components/ui/button'
import {
  ApiError,
  createBooking,
  type Booking,
  type MeetingType,
  type Slot,
} from '@/lib/api'
import { formatMoscowDay, formatMoscowTime } from '@/lib/format'

type BookingFormProps = {
  meetingType: MeetingType
  slot: Slot
  onBooked: (booking: Booking) => void
  onConflict: () => void
  onCancel: () => void
}

export function BookingForm({
  meetingType,
  slot,
  onBooked,
  onConflict,
  onCancel,
}: BookingFormProps) {
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setError(null)
    setIsSubmitting(true)

    try {
      const booking = await createBooking({
        meetingTypeId: meetingType.id,
        startsAt: slot.startsAt,
        guestName,
        guestEmail,
      })
      onBooked(booking)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        onConflict()
        return
      }

      setError(caught instanceof Error ? caught.message : 'Не удалось забронировать встречу')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Данные гостя</h2>
        <p className="text-sm text-muted-foreground">
          {meetingType.title}: {formatMoscowDay(slot.startsAt)},{' '}
          {formatMoscowTime(slot.startsAt)}–{formatMoscowTime(slot.endsAt)}
        </p>
      </div>

      <form className="space-y-4" noValidate onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="booking-guest-name">
            Имя
          </label>
          <input
            autoComplete="name"
            className={inputClassName}
            id="booking-guest-name"
            onChange={(event) => setGuestName(event.target.value)}
            value={guestName}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="booking-guest-email">
            Почта
          </label>
          <input
            autoComplete="email"
            className={inputClassName}
            id="booking-guest-email"
            inputMode="email"
            onChange={(event) => setGuestEmail(event.target.value)}
            type="email"
            value={guestEmail}
          />
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Бронирование…' : 'Забронировать'}
          </Button>
          <Button onClick={onCancel} type="button" variant="outline">
            Отменить
          </Button>
        </div>
      </form>
    </section>
  )
}
