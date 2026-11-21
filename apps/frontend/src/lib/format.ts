const MOSCOW_TIME_ZONE = 'Europe/Moscow'

const moscowDayLabelFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

const moscowTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MOSCOW_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const moscowDayPartsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: MOSCOW_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function moscowDayKey(iso: string): string {
  const parts = moscowDayPartsFormatter.formatToParts(new Date(iso))
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${value('year')}-${value('month')}-${value('day')}`
}

export function formatMoscowDay(iso: string): string {
  const label = moscowDayLabelFormatter.format(new Date(iso))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function formatMoscowTime(iso: string): string {
  return moscowTimeFormatter.format(new Date(iso))
}

export function formatDuration(minutes: number): string {
  const mod10 = minutes % 10
  const mod100 = minutes % 100

  if (mod10 === 1 && mod100 !== 11) {
    return `${minutes} минута`
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${minutes} минуты`
  }

  return `${minutes} минут`
}
