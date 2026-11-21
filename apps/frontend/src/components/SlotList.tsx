import type { Slot } from '@/lib/api'
import { formatMoscowDay, formatMoscowTime, moscowDayKey } from '@/lib/format'

type SlotGroup = {
  key: string
  label: string
  slots: Slot[]
}

function groupSlots(slots: Slot[]): SlotGroup[] {
  const groups = new Map<string, SlotGroup>()

  for (const slot of slots) {
    const key = moscowDayKey(slot.startsAt)
    const group = groups.get(key)

    if (group) {
      group.slots.push(slot)
    } else {
      groups.set(key, {
        key,
        label: formatMoscowDay(slot.startsAt),
        slots: [slot],
      })
    }
  }

  return [...groups.values()]
}

type SlotListProps = {
  slots: Slot[]
  selectedStartsAt: string | undefined
  onSelect: (slot: Slot) => void
}

export function SlotList({ slots, selectedStartsAt, onSelect }: SlotListProps) {
  const groups = groupSlots(slots)

  return (
    <div className="space-y-6" data-testid="slot-list">
      {groups.map((group) => (
        <section
          aria-labelledby={`slot-day-${group.key}`}
          data-testid="slot-day"
          key={group.key}
        >
          <h3
            className="mb-2 text-sm font-semibold"
            id={`slot-day-${group.key}`}
          >
            {group.label}
          </h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {group.slots.map((slot) => {
              const isSelected = selectedStartsAt === slot.startsAt
              const isUnavailable = !slot.isAvailable
              const label = `${formatMoscowTime(slot.startsAt)}–${formatMoscowTime(slot.endsAt)}`

              return (
                <li key={slot.startsAt}>
                  <button
                    aria-label={`${label}${isUnavailable ? ', занято' : ''}`}
                    aria-pressed={isSelected}
                    className={[
                      'w-full rounded-md border px-2 py-1.5 text-center text-sm tabular-nums transition-colors',
                      isUnavailable
                        ? 'cursor-not-allowed border-border bg-muted text-muted-foreground opacity-60'
                        : isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:bg-muted',
                    ].join(' ')}
                    data-available={slot.isAvailable}
                    data-testid="slot"
                    disabled={isUnavailable}
                    onClick={() => onSelect(slot)}
                    type="button"
                  >
                    {label}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
