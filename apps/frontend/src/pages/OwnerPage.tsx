import { useEffect, useState } from 'react'
import { BookingList } from '@/components/BookingList'
import { MeetingTypeForm } from '@/components/MeetingTypeForm'
import { MeetingTypeList } from '@/components/MeetingTypeList'
import { PageLayout } from '@/components/PageLayout'
import { Button } from '@/components/ui/button'
import { clearData, listBookings, listMeetingTypes } from '@/lib/api'
import { useApiResource } from '@/lib/useApiResource'

export function OwnerPage() {
  const [meetingTypesReloadKey, setMeetingTypesReloadKey] = useState(0)
  const [bookingsReloadKey, setBookingsReloadKey] = useState(0)
  const [isClearing, setIsClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  const meetingTypesResource = useApiResource(
    listMeetingTypes,
    [meetingTypesReloadKey],
    {
      fallbackError: 'Не удалось загрузить типы встреч',
    },
  )
  const bookingsResource = useApiResource(listBookings, [bookingsReloadKey], {
    fallbackError: 'Не удалось загрузить брони',
  })

  const meetingTypes = meetingTypesResource.data ?? []
  const bookings = bookingsResource.data ?? []

  function refresh() {
    setMeetingTypesReloadKey((key) => key + 1)
    setBookingsReloadKey((key) => key + 1)
  }

  const hasData = meetingTypes.length > 0 || bookings.length > 0
  const isClearDisabled =
    isClearing ||
    meetingTypesResource.isLoading ||
    bookingsResource.isLoading ||
    !hasData

  async function handleClear() {
    setIsClearing(true)
    setClearError(null)

    try {
      await clearData()
      meetingTypesResource.setData([])
      bookingsResource.setData([])
      refresh()
    } catch (caught) {
      setClearError(
        caught instanceof Error ? caught.message : 'Не удалось очистить данные',
      )
    } finally {
      setIsClearing(false)
    }
  }

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }

    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return (
    <PageLayout
      subtitle="Создайте тип встречи, чтобы гости могли его забронировать"
      title="Управление календарём"
    >
      <section className="space-y-2">
        <Button
          data-testid="clear-data"
          disabled={isClearDisabled}
          onClick={() => void handleClear()}
          type="button"
          variant="destructive"
        >
          Очистить данные
        </Button>
        {clearError ? (
          <p className="text-sm text-destructive" role="alert">
            {clearError}
          </p>
        ) : null}
      </section>
      <MeetingTypeForm
        onCreated={(meetingType) =>
          meetingTypesResource.setData((current) => [
            ...(current ?? []),
            meetingType,
          ])
        }
      />
      <MeetingTypeList
        isLoading={meetingTypesResource.isLoading}
        loadError={meetingTypesResource.error}
        meetingTypes={meetingTypes}
      />
      <BookingList
        bookings={bookings}
        isLoading={bookingsResource.isLoading}
        loadError={bookingsResource.error}
        meetingTypes={meetingTypes}
        onRefresh={refresh}
      />
    </PageLayout>
  )
}
