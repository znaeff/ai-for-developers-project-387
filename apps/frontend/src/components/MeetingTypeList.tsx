import type { MeetingType } from '@/lib/api'
import { formatDuration } from '@/lib/format'

type MeetingTypeListProps = {
  meetingTypes: MeetingType[]
  isLoading: boolean
  loadError: string | null
}

export function MeetingTypeList({
  meetingTypes,
  isLoading,
  loadError,
}: MeetingTypeListProps) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Созданные типы встреч</h2>

      {isLoading ? <p className="text-muted-foreground">Загрузка…</p> : null}

      {loadError ? (
        <p className="text-sm text-destructive" role="alert">
          {loadError}
        </p>
      ) : null}

      {!isLoading && !loadError && meetingTypes.length === 0 ? (
        <p className="text-muted-foreground">Пока нет созданных типов встреч.</p>
      ) : null}

      {meetingTypes.length > 0 ? (
        <ul className="space-y-3">
          {meetingTypes.map((meetingType) => (
            <li
              className="space-y-2 rounded-lg border border-border p-4"
              key={meetingType.id}
            >
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="font-medium">{meetingType.title}</h3>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {formatDuration(meetingType.durationMinutes)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {meetingType.description || 'Без описания'}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
