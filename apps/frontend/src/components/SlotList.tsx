import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
  const lockedDayKey = selectedStartsAt ? moscowDayKey(selectedStartsAt) : undefined
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => {
    const firstWithFreeSlots = groups.find((group) =>
      group.slots.some((slot) => slot.isAvailable),
    )
    return new Set(firstWithFreeSlots ? [firstWithFreeSlots.key] : [])
  })

  function isDayExpanded(key: string) {
    return expandedDays.has(key) || key === lockedDayKey
  }

  function toggleDay(key: string) {
    setExpandedDays((current) => {
      if (key === lockedDayKey) return current
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const allExpanded =
    groups.length > 0 && groups.every((group) => isDayExpanded(group.key))
  const toggleAllLabel = allExpanded ? 'Свернуть все' : 'Развернуть все'

  function toggleAllDays() {
    if (allExpanded) {
      setExpandedDays(lockedDayKey ? new Set([lockedDayKey]) : new Set<string>())
    } else {
      setExpandedDays(new Set(groups.map((group) => group.key)))
    }
  }

  return (
    <div className="space-y-6" data-testid="slot-list">
      <div className="flex justify-end">
        <Button
          aria-label={toggleAllLabel}
          data-testid="slot-toggle-all"
          onClick={toggleAllDays}
          size="sm"
          type="button"
          variant="outline"
        >
          {toggleAllLabel}
        </Button>
      </div>
      {groups.map((group) => {
        const isExpanded = isDayExpanded(group.key)
        const panelId = `slot-day-panel-${group.key}`

        return (
          <section
            aria-labelledby={`slot-day-${group.key}`}
            data-date={group.key}
            data-testid="slot-day"
            key={group.key}
          >
            <h3
              className="mb-2 text-sm font-semibold"
              id={`slot-day-${group.key}`}
            >
              <button
                aria-controls={panelId}
                aria-expanded={isExpanded}
                className="flex w-full items-center justify-between gap-2 rounded-md text-left hover:underline"
                onClick={() => toggleDay(group.key)}
                type="button"
              >
                {group.label}
                <span aria-hidden="true">{isExpanded ? '−' : '+'}</span>
              </button>
            </h3>
            {isExpanded ? (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" id={panelId}>
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
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
