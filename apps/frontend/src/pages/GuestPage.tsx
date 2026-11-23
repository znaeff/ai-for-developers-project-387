import { useState } from 'react'
import { BookingConfirmation } from '@/components/BookingConfirmation'
import { BookingForm } from '@/components/BookingForm'
import { PageLayout } from '@/components/PageLayout'
import { SlotList } from '@/components/SlotList'
import { Button } from '@/components/ui/button'
import {
  listMeetingTypes,
  listSlots,
  type Booking,
  type MeetingType,
  type Slot,
} from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { useApiResource } from '@/lib/useApiResource'

const CONFLICT_MESSAGE =
  'Этот слот уже занят. Пожалуйста, выберите другое время.'

export function GuestPage() {
  const [selectedType, setSelectedType] = useState<MeetingType | null>(null)
  const [slotsReloadKey, setSlotsReloadKey] = useState(0)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [booking, setBooking] = useState<Booking | null>(null)
  const [conflictMessage, setConflictMessage] = useState<string | null>(null)

  const meetingTypesResource = useApiResource(listMeetingTypes, [], {
    fallbackError: 'Не удалось загрузить типы встреч',
  })
  const slotsResource = useApiResource(
    () => (selectedType ? listSlots(selectedType.id) : Promise.resolve([])),
    [selectedType?.id, slotsReloadKey],
    {
      fallbackError: 'Не удалось загрузить слоты',
      enabled: selectedType !== null,
      resetKey: selectedType?.id,
    },
  )

  const meetingTypes = meetingTypesResource.data ?? []
  const slots = slotsResource.isLoading ? [] : (slotsResource.data ?? [])
  const availableSlots = slots.filter((slot) => slot.isAvailable)

  function selectMeetingType(meetingType: MeetingType) {
    setSelectedType(meetingType)
    setSelectedSlot(null)
    setBooking(null)
    setConflictMessage(null)
  }

  function returnToMeetingTypes() {
    setSelectedType(null)
    setSelectedSlot(null)
    setBooking(null)
    setConflictMessage(null)
  }

  function selectSlot(slot: Slot) {
    setSelectedSlot(slot)
    setBooking(null)
    setConflictMessage(null)
  }

  function handleBooked(created: Booking) {
    setBooking(created)
    setSelectedSlot(null)
    setConflictMessage(null)
    setSlotsReloadKey((key) => key + 1)
  }

  function handleConflict() {
    setConflictMessage(CONFLICT_MESSAGE)
    setSelectedSlot(null)
    setSlotsReloadKey((key) => key + 1)
  }

  return (
    <PageLayout
      subtitle="Выберите тип встречи и свободное время"
      title="Бронировать встречу"
    >
      {selectedType ? (
        <section className="space-y-6">
          <div className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{selectedType.title}</h2>
              <p className="text-sm text-muted-foreground">
                {selectedType.description || 'Без описания'}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatDuration(selectedType.durationMinutes)}
              </p>
            </div>
            <Button onClick={returnToMeetingTypes} type="button" variant="outline">
              Выбрать другой тип
            </Button>
          </div>

          <div className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Свободные слоты</h2>
              <p className="text-sm text-muted-foreground">
                Ближайшие 14 дней, время указано по Москве.
              </p>
            </div>

            {conflictMessage ? (
              <p
                aria-live="assertive"
                className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                role="alert"
              >
                {conflictMessage}
              </p>
            ) : null}

            {booking ? (
              <BookingConfirmation booking={booking} meetingType={selectedType} />
            ) : null}

            {selectedSlot ? (
              <BookingForm
                meetingType={selectedType}
                onBooked={handleBooked}
                onCancel={() => setSelectedSlot(null)}
                onConflict={handleConflict}
                slot={selectedSlot}
              />
            ) : null}

            {slotsResource.isLoading ? (
              <p className="text-muted-foreground">Загрузка слотов…</p>
            ) : null}

            {slotsResource.error ? (
              <p className="text-sm text-destructive" role="alert">
                {slotsResource.error}
              </p>
            ) : null}

            {!slotsResource.isLoading &&
            !slotsResource.error &&
            availableSlots.length === 0 ? (
              <p className="text-muted-foreground">Свободных слотов нет.</p>
            ) : null}

            {slots.length > 0 ? (
              <SlotList
                onSelect={selectSlot}
                selectedStartsAt={selectedSlot?.startsAt}
                slots={slots}
              />
            ) : null}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Выберите тип встречи</h2>

          {meetingTypesResource.isLoading ? (
            <p className="text-muted-foreground">Загрузка типов встреч…</p>
          ) : null}

          {meetingTypesResource.error ? (
            <p className="text-sm text-destructive" role="alert">
              {meetingTypesResource.error}
            </p>
          ) : null}

          {!meetingTypesResource.isLoading &&
          !meetingTypesResource.error &&
          meetingTypes.length === 0 ? (
            <>
              <p className="text-muted-foreground">Пока нет типов встреч.</p>
              <p className="text-sm text-muted-foreground">
                Создайте типы встреч{' '}
                <a className="underline" href="/owner">
                  здесь
                </a>
              </p>
            </>
          ) : null}

          {meetingTypes.length > 0 ? (
            <ul className="space-y-3">
              {meetingTypes.map((meetingType) => (
                <li key={meetingType.id}>
                  <button
                    className="w-full space-y-2 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted"
                    onClick={() => selectMeetingType(meetingType)}
                    type="button"
                  >
                    <span className="flex items-baseline justify-between gap-4">
                      <span className="font-medium">{meetingType.title}</span>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {formatDuration(meetingType.durationMinutes)}
                      </span>
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {meetingType.description || 'Без описания'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </PageLayout>
  )
}
