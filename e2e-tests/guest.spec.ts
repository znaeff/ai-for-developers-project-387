import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'

type SlotResponse = {
  startsAt: string
  endsAt: string
  isAvailable: boolean
}

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function dayByDate(page: Page, date: string) {
  return page.locator(`[data-testid="slot-day"][data-date="${date}"]`)
}

function dayKey(startsAt: string) {
  return startsAt.slice(0, 10)
}

function dayKeys(slots: SlotResponse[]) {
  return [...new Set(slots.map((slot) => dayKey(slot.startsAt)))]
}

function emptyMeetingTypeTexts(page: Page) {
  return {
    message: page.getByText('Пока нет типов встреч.', { exact: true }),
    hint: page.getByText('Создать типы встреч здесь', { exact: true }),
  }
}

function requireTwoDates(slots: SlotResponse[]) {
  const dates = dayKeys(slots)
  if (dates.length < 2) throw new Error('Expected at least two days')

  return dates
}

async function expandDayIfCollapsed(page: Page, date: string) {
  const header = dayByDate(page, date).getByRole('button', { expanded: false })
  if (await header.count()) await header.click()
}

async function createMeetingTypeViaApi(
  request: APIRequestContext,
  durationMinutes = 60,
) {
  const title = uniqueTitle('Сворачивание')
  const created = await request.post('/api/meeting-types', {
    data: {
      title,
      description: 'Проверка сворачивания дней',
      durationMinutes,
    },
  })
  expect(created.status()).toBe(201)
  const meetingType = (await created.json()) as { id: string }

  return { id: meetingType.id, title }
}

async function listSlots(request: APIRequestContext, meetingTypeId: string) {
  const response = await request.get(
    `/api/meeting-types/${meetingTypeId}/slots`,
  )
  expect(response.status()).toBe(200)

  return (await response.json()) as SlotResponse[]
}

async function findMeetingTypeByTitle(request: APIRequestContext, title: string) {
  const response = await request.get('/api/meeting-types')
  const meetingTypes = (await response.json()) as Array<{
    id: string
    title: string
  }>
  const meetingType = meetingTypes.find((item) => item.title === title)
  if (!meetingType) throw new Error(`Meeting type ${title} was not created`)

  return meetingType
}

async function bookAllAvailableInDay(
  request: APIRequestContext,
  meetingTypeId: string,
  date: string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const slots = await listSlots(request, meetingTypeId)
    const slot = slots.find(
      (item) => item.startsAt.startsWith(date) && item.isAvailable,
    )
    if (!slot) return

    const booked = await request.post('/api/bookings', {
      data: {
        meetingTypeId,
        startsAt: slot.startsAt,
        guestName: 'Занятый гость',
        guestEmail: `busy-${date}-${attempt}@example.com`,
      },
    })
    expect(booked.status()).toBe(201)
  }

  throw new Error('Too many slots to book')
}

async function selectMeetingType(page: Page, title: string) {
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()
}

async function takeSlotViaApi(
  request: APIRequestContext,
  meetingTypeId: string,
  startsAt: string,
) {
  const taken = await request.post('/api/bookings', {
    data: {
      meetingTypeId,
      startsAt,
      guestName: 'Другой гость',
      guestEmail: 'other@example.com',
    },
  })
  expect(taken.status()).toBe(201)
}

async function openMeetingType(page: Page, title: string) {
  await page.goto('/guest')
  await selectMeetingType(page, title)
}

const GUEST_NAME = 'Анна'
const GUEST_EMAIL = 'anna@example.com'

async function submitBookingForm(page: Page) {
  await page.getByLabel('Имя').fill(GUEST_NAME)
  await page.getByLabel('Почта').fill(GUEST_EMAIL)
  await page.getByRole('button', { name: 'Забронировать' }).click()
}

async function createMeetingType(
  page: Page,
  input: { title: string; description: string; durationMinutes: string },
) {
  await page.goto('/owner')
  await page.getByLabel('Название').fill(input.title)
  await page.getByLabel('Описание').fill(input.description)
  await page.getByLabel('Длительность, минут').selectOption(input.durationMinutes)
  await page.getByRole('button', { name: 'Создать тип встречи' }).click()

  await expect(page.getByRole('listitem').filter({ hasText: input.title })).toBeVisible()
}

test('guest sees an owner link below the empty meeting type message', async ({
  page,
}) => {
  await page.goto('/guest')

  const { message, hint } = emptyMeetingTypeTexts(page)
  await expect(message).toBeVisible()
  await expect(hint).toBeVisible()

  const links = hint.getByRole('link')
  await expect(links).toHaveCount(1)
  await expect(links.first()).toHaveText('здесь')
  await expect(links.first()).toHaveAttribute('href', '/owner')

  await links.first().click()
  await expect(page).toHaveURL(/\/owner$/)
  await expect(
    page.getByRole('heading', { name: 'Управление календарём' }),
  ).toBeVisible()
})

test('guest does not see the owner link when meeting types exist', async ({
  page,
  request,
}) => {
  await createMeetingTypeViaApi(request)

  await page.goto('/guest')

  const { message, hint } = emptyMeetingTypeTexts(page)
  await expect(page.getByRole('button', { name: /Сворачивание/ })).toBeVisible()
  await expect(message).toHaveCount(0)
  await expect(hint).toHaveCount(0)
})

test('guest does not see the owner link while meeting types are loading', async ({
  page,
}) => {
  let continueLoading = () => {}
  const loading = new Promise<void>((resolve) => {
    continueLoading = resolve
  })
  await page.route('**/api/meeting-types', async (route) => {
    if (route.request().method() === 'GET') await loading
    await route.continue()
  })

  const { message, hint } = emptyMeetingTypeTexts(page)

  await page.goto('/guest', { waitUntil: 'commit' })

  await expect(page.getByText('Загрузка типов встреч…')).toBeVisible()
  await expect(hint).toHaveCount(0)

  continueLoading()

  await expect(message).toBeVisible()
  await expect(hint).toBeVisible()
})

test('guest does not see the owner link when meeting types fail to load', async ({
  page,
}) => {
  await page.route('**/api/meeting-types', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Тестовая ошибка загрузки' }),
    })
  })

  const { message, hint } = emptyMeetingTypeTexts(page)

  await page.goto('/guest')

  await expect(page.getByRole('alert')).toContainText('Тестовая ошибка загрузки')
  await expect(message).toHaveCount(0)
  await expect(hint).toHaveCount(0)
})

test('guest sees only the nearest day with free slots expanded', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const initialSlots = await listSlots(request, id)
  const firstSlot = initialSlots[0]
  const firstDate = firstSlot ? dayKey(firstSlot.startsAt) : undefined
  if (!firstDate) throw new Error('No slots returned')

  await bookAllAvailableInDay(request, id, firstDate)

  const remainingSlots = await listSlots(request, id)
  const nextStartsAt = remainingSlots.find((slot) => slot.isAvailable)?.startsAt
  const nextDate = nextStartsAt ? dayKey(nextStartsAt) : undefined
  if (!nextDate) throw new Error('No free slots left')

  await openMeetingType(page, title)

  const firstDay = dayByDate(page, firstDate)
  const nextDay = dayByDate(page, nextDate)
  await expect(firstDay.getByRole('button', { expanded: false })).toBeVisible()
  await expect(firstDay.getByTestId('slot')).toHaveCount(0)
  await expect(nextDay.getByRole('button', { expanded: true })).toBeVisible()
  await expect(nextDay.getByTestId('slot').first()).toBeVisible()
})

test('guest expands and collapses days independently', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const dates = requireTwoDates(slots)
  const [firstDate, secondDate] = dates

  await openMeetingType(page, title)

  const firstDay = dayByDate(page, firstDate)
  const secondDay = dayByDate(page, secondDate)
  await expect(firstDay.getByRole('button', { expanded: true })).toBeVisible()
  await expect(secondDay.getByRole('button', { expanded: false })).toBeVisible()

  await secondDay.getByRole('button', { expanded: false }).click()
  await expect(secondDay.getByRole('button', { expanded: true })).toBeVisible()
  await expect(firstDay.getByRole('button', { expanded: true })).toBeVisible()
  await expect(secondDay.getByTestId('slot').first()).toBeVisible()

  await firstDay.getByRole('button', { expanded: true }).click()
  await expect(firstDay.getByRole('button', { expanded: false })).toBeVisible()
  await expect(secondDay.getByRole('button', { expanded: true })).toBeVisible()
  await expect(firstDay.getByTestId('slot')).toHaveCount(0)
})

test('guest expands all days at once from the default compact list', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const dates = requireTwoDates(slots)

  await openMeetingType(page, title)

  const toggleAll = page.getByTestId('slot-toggle-all')
  await expect(toggleAll).toHaveText('Развернуть все')
  await expect(toggleAll).toHaveAttribute('aria-label', 'Развернуть все')

  await toggleAll.click()

  for (const date of dates) {
    const day = dayByDate(page, date)
    await expect(day.getByRole('button', { expanded: true })).toBeVisible()
    await expect(day.getByTestId('slot').first()).toBeVisible()
  }
  await expect(toggleAll).toHaveText('Свернуть все')
  await expect(toggleAll).toHaveAttribute('aria-label', 'Свернуть все')
})

test('guest collapses all days at once and can expand them again', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const dates = requireTwoDates(slots)

  await openMeetingType(page, title)

  const toggleAll = page.getByTestId('slot-toggle-all')
  await toggleAll.click()
  await expect(toggleAll).toHaveText('Свернуть все')

  await toggleAll.click()

  for (const date of dates) {
    const day = dayByDate(page, date)
    await expect(day.getByRole('button', { expanded: false })).toBeVisible()
    await expect(day.getByTestId('slot')).toHaveCount(0)
  }
  await expect(toggleAll).toHaveText('Развернуть все')
  await expect(toggleAll).toHaveAttribute('aria-label', 'Развернуть все')

  await toggleAll.click()

  for (const date of dates) {
    const day = dayByDate(page, date)
    await expect(day.getByRole('button', { expanded: true })).toBeVisible()
    await expect(day.getByTestId('slot').first()).toBeVisible()
  }
  await expect(toggleAll).toHaveText('Свернуть все')
  await expect(toggleAll).toHaveAttribute('aria-label', 'Свернуть все')
})

test('guest sees the default day expansion again after reloading slots', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const dates = requireTwoDates(slots)
  const [firstDate, secondDate] = dates

  await openMeetingType(page, title)

  const firstDay = dayByDate(page, firstDate)
  const secondDay = dayByDate(page, secondDate)
  await firstDay.getByRole('button', { expanded: true }).click()
  await secondDay.getByRole('button', { expanded: false }).click()
  await expect(firstDay.getByRole('button', { expanded: false })).toBeVisible()
  await expect(secondDay.getByRole('button', { expanded: true })).toBeVisible()

  await page.getByRole('button', { name: 'Выбрать другой тип' }).click()
  await selectMeetingType(page, title)
  await expect(firstDay.getByRole('button', { expanded: true })).toBeVisible()
  await expect(secondDay.getByRole('button', { expanded: false })).toBeVisible()
  await expect(firstDay.getByTestId('slot').first()).toBeVisible()
  await expect(secondDay.getByTestId('slot')).toHaveCount(0)
})

test('guest selects a meeting type and sees slots grouped by days', async ({
  page,
  request,
}) => {
  const title = uniqueTitle('Слоты')

  await createMeetingType(page, {
    title,
    description: 'Свободные слоты для гостя',
    durationMinutes: '30',
  })

  const meetingType = await findMeetingTypeByTitle(request, title)
  const slots = await listSlots(request, meetingType.id)
  const firstDate = slots[0] ? dayKey(slots[0].startsAt) : undefined
  if (!firstDate) throw new Error('No slots returned')

  await page.goto('/guest')
  await expect(page.getByRole('heading', { name: 'Выберите тип встречи' })).toBeVisible()

  await selectMeetingType(page, title)

  const days = page.getByTestId('slot-day')
  await expect(days.first()).toBeVisible()
  expect(await days.count()).toBeGreaterThan(0)

  const firstDay = dayByDate(page, firstDate)
  await expect(firstDay.getByRole('heading')).toHaveText(
    /^(Понедельник|Вторник|Среда|Четверг|Пятница),/,
  )
  await expect(firstDay.getByTestId('slot').first()).toHaveText(
    /^\d{2}:\d{2}–\d{2}:\d{2}$/,
  )

  await page.getByRole('button', { name: 'Выбрать другой тип' }).click()
  await expect(page.getByRole('heading', { name: 'Выберите тип встречи' })).toBeVisible()
})

test('guest sees an empty state when all slots are booked', async ({
  page,
  request,
}) => {
  const title = uniqueTitle('Заполненный календарь')

  await createMeetingType(page, {
    title,
    description: 'Все слоты будут заняты',
    durationMinutes: '60',
  })

  const meetingType = await findMeetingTypeByTitle(request, title)

  let slotsResponse = await request.get(
    `/api/meeting-types/${meetingType.id}/slots`,
  )
  let slots = ((await slotsResponse.json()) as SlotResponse[]).filter(
    (slot) => slot.isAvailable,
  )
  const firstDate = slots[0] ? dayKey(slots[0].startsAt) : undefined
  if (!firstDate) throw new Error('No slots returned')

  for (let attempt = 0; slots.length > 0; attempt += 1) {
    if (attempt >= 200) {
      throw new Error('Too many slots to fill')
    }

    const booked = await request.post('/api/bookings', {
      data: {
        meetingTypeId: meetingType.id,
        startsAt: slots[0]?.startsAt,
        guestName: 'Занятый гость',
        guestEmail: `filled-${attempt}@example.com`,
      },
    })
    expect(booked.status()).toBe(201)

    slotsResponse = await request.get(
      `/api/meeting-types/${meetingType.id}/slots`,
    )
    slots = ((await slotsResponse.json()) as SlotResponse[]).filter(
      (slot) => slot.isAvailable,
    )
  }

  await openMeetingType(page, title)
  await expect(page.getByText('Свободных слотов нет.')).toBeVisible()

  const days = page.getByTestId('slot-day')
  expect(await days.count()).toBeGreaterThan(0)
  for (const day of await days.all()) {
    await expect(day.getByRole('button', { expanded: false })).toBeVisible()
    await expect(day.getByTestId('slot')).toHaveCount(0)
  }

  const firstDay = dayByDate(page, firstDate)
  await firstDay.getByRole('button', { expanded: false }).click()
  await expect(firstDay.getByRole('button', { expanded: true })).toBeVisible()
  await expect(firstDay.getByTestId('slot').first()).toBeDisabled()
})

test('guest books a slot and it becomes unavailable', {
  tag: '@head-browser-main',
}, async ({ page, request }) => {
  const title = uniqueTitle('Бронирование')

  await createMeetingType(page, {
    title,
    description: 'Встреча с подтверждением',
    durationMinutes: '30',
  })

  const meetingType = await findMeetingTypeByTitle(request, title)
  const slots = await listSlots(request, meetingType.id)
  const firstDate = slots[0] ? dayKey(slots[0].startsAt) : undefined
  if (!firstDate) throw new Error('No slots returned')

  await openMeetingType(page, title)

  const firstDay = dayByDate(page, firstDate)
  const slot = firstDay.getByTestId('slot').first()
  const slotLabel = (await slot.innerText()).trim()

  await slot.click()

  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toBeVisible()
  await submitBookingForm(page)

  const confirmation = page.getByTestId('booking-confirmation')
  await expect(confirmation).toBeVisible()
  await expect(confirmation).toContainText(title)
  await expect(confirmation).toContainText(slotLabel)
  await expect(confirmation).toContainText('Анна')

  await expandDayIfCollapsed(page, firstDate)

  const bookedSlot = firstDay.getByTestId('slot').filter({ hasText: slotLabel })

  await expect(bookedSlot).toBeVisible()
  await expect(bookedSlot).toBeDisabled()
})

test('guest sees a fresh slot list when the chosen slot was taken', async ({
  page,
  request,
}) => {
  const title = uniqueTitle('Конфликт')

  const created = await request.post('/api/meeting-types', {
    data: { title, description: 'Слот займут до отправки формы', durationMinutes: 30 },
  })
  expect(created.status()).toBe(201)
  const meetingType = (await created.json()) as { id: string }

  const slots = await listSlots(request, meetingType.id)
  const startsAt = slots[0]?.startsAt
  expect(startsAt).toBeTruthy()
  const firstDate = startsAt ? dayKey(startsAt) : undefined
  if (!firstDate) throw new Error('No slots returned')

  await openMeetingType(page, title)

  const firstDay = dayByDate(page, firstDate)
  const firstSlot = firstDay.getByTestId('slot').first()
  const slotLabel = (await firstSlot.innerText()).trim()
  await firstSlot.click()

  await takeSlotViaApi(request, meetingType.id, startsAt)

  await submitBookingForm(page)

  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText(
    'Этот слот уже занят. Пожалуйста, выберите другое время.',
  )
  await expandDayIfCollapsed(page, firstDate)

  const conflictSlot = firstDay.getByTestId('slot').filter({ hasText: slotLabel })

  await expect(conflictSlot).toBeVisible()
  await expect(conflictSlot).toBeDisabled()
})

test('guest sees validation errors in the booking form', async ({ page }) => {
  const title = uniqueTitle('Валидация')

  await createMeetingType(page, {
    title,
    description: 'Проверка формы',
    durationMinutes: '30',
  })

  await openMeetingType(page, title)
  await page.getByTestId('slot').first().click()

  await page.getByLabel('Почта').fill('anna@example.com')
  await page.getByRole('button', { name: 'Забронировать' }).click()
  await expect(page.getByRole('alert')).toContainText('Имя обязательно')

  await page.getByLabel('Имя').fill('Анна')
  await page.getByLabel('Почта').fill('anna@')
  await page.getByRole('button', { name: 'Забронировать' }).click()
  await expect(page.getByRole('alert')).toContainText('Почта')
})

test('guest keeps the selected slot day expanded while the booking form is open', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const freeSlot = slots.find((slot) => slot.isAvailable)
  if (!freeSlot) throw new Error('No free slots left')
  const date = dayKey(freeSlot.startsAt)

  await openMeetingType(page, title)

  const day = dayByDate(page, date)
  const slot = day.getByTestId('slot').first()
  await slot.click()
  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toBeVisible()
  await expect(day.getByRole('button', { expanded: true })).toBeVisible()

  await day.getByRole('button', { expanded: true }).click()

  await expect(day.getByRole('button', { expanded: true })).toBeVisible()
  await expect(slot).toBeVisible()
})

test('guest collapses every other day while the selected slot day stays open', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const freeSlot = slots.find((slot) => slot.isAvailable)
  if (!freeSlot) throw new Error('No free slots left')
  const date = dayKey(freeSlot.startsAt)
  const otherDates = [
    ...dayKeys(slots),
  ].filter((item) => item !== date)
  if (otherDates.length === 0) throw new Error('Expected at least two days')

  await openMeetingType(page, title)

  const day = dayByDate(page, date)
  await day.getByTestId('slot').first().click()
  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toBeVisible()

  const toggleAll = page.getByTestId('slot-toggle-all')
  await toggleAll.click()
  await expect(toggleAll).toHaveText('Свернуть все')
  await toggleAll.click()

  await expect(day.getByRole('button', { expanded: true })).toBeVisible()
  await expect(day.getByTestId('slot').first()).toBeVisible()
  for (const otherDate of otherDates) {
    const otherDay = dayByDate(page, otherDate)
    await expect(otherDay.getByRole('button', { expanded: false })).toBeVisible()
    await expect(otherDay.getByTestId('slot')).toHaveCount(0)
  }
})

test('guest can collapse a former selected day after cancelling the booking', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const freeSlot = slots.find((slot) => slot.isAvailable)
  if (!freeSlot) throw new Error('No free slots left')
  const date = dayKey(freeSlot.startsAt)

  await openMeetingType(page, title)

  const day = dayByDate(page, date)
  await day.getByTestId('slot').first().click()
  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toBeVisible()

  const toggleAll = page.getByTestId('slot-toggle-all')
  await toggleAll.click()
  await toggleAll.click()
  await expect(day.getByRole('button', { expanded: true })).toBeVisible()

  await page.getByRole('button', { name: 'Отменить' }).click()

  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toHaveCount(0)
  await expect(day.getByRole('button', { expanded: true })).toBeVisible()

  await day.getByRole('button', { expanded: true }).click()

  await expect(day.getByRole('button', { expanded: false })).toBeVisible()
  await expect(day.getByTestId('slot')).toHaveCount(0)
})

test('guest moves the locked day when choosing another slot', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const firstAvailable = slots.find((slot) => slot.isAvailable)?.startsAt
  const firstDate = firstAvailable ? dayKey(firstAvailable) : undefined
  const secondAvailable = slots.find(
    (slot) => slot.isAvailable && !slot.startsAt.startsWith(firstDate ?? ''),
  )?.startsAt
  const secondDate = secondAvailable ? dayKey(secondAvailable) : undefined
  if (!firstDate || !secondDate) throw new Error('Expected free slots on two days')

  await openMeetingType(page, title)

  const firstDay = dayByDate(page, firstDate)
  const secondDay = dayByDate(page, secondDate)
  await firstDay.getByTestId('slot').first().click()
  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toBeVisible()
  await expect(firstDay.getByRole('button', { expanded: true })).toBeVisible()

  await secondDay.getByRole('button', { expanded: false }).click()
  await secondDay.getByTestId('slot').first().click()
  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toBeVisible()
  await expect(secondDay.getByTestId('slot').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await firstDay.getByRole('button', { expanded: true }).click()

  await expect(firstDay.getByRole('button', { expanded: false })).toBeVisible()
  await expect(secondDay.getByRole('button', { expanded: true })).toBeVisible()
  await secondDay.getByRole('button', { expanded: true }).click()
  await expect(secondDay.getByRole('button', { expanded: true })).toBeVisible()
})

test('guest sees the default day expansion again after booking a slot', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const firstAvailable = slots.find((slot) => slot.isAvailable)?.startsAt
  const firstDate = firstAvailable ? dayKey(firstAvailable) : undefined
  if (!firstDate) throw new Error('No free slots left')
  const otherDates = [
    ...dayKeys(slots),
  ].filter((item) => item !== firstDate)
  if (otherDates.length === 0) throw new Error('Expected at least two days')

  await openMeetingType(page, title)

  await page.getByTestId('slot-toggle-all').click()
  await expect(page.getByTestId('slot-toggle-all')).toHaveText('Свернуть все')

  const firstDay = dayByDate(page, firstDate)
  await firstDay.getByTestId('slot').first().click()
  await submitBookingForm(page)

  await expect(page.getByTestId('booking-confirmation')).toBeVisible()
  await expect(firstDay.getByRole('button', { expanded: true })).toBeVisible()
  for (const otherDate of otherDates) {
    const otherDay = dayByDate(page, otherDate)
    await expect(otherDay.getByRole('button', { expanded: false })).toBeVisible()
    await expect(otherDay.getByTestId('slot')).toHaveCount(0)
  }
})

test('guest sees the default day expansion again after a booking conflict', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const startsAt = slots.find((slot) => slot.isAvailable)?.startsAt
  if (!startsAt) throw new Error('No free slots left')
  const firstDate = dayKey(startsAt)
  const otherDates = [
    ...dayKeys(slots),
  ].filter((item) => item !== firstDate)
  if (otherDates.length === 0) throw new Error('Expected at least two days')

  await openMeetingType(page, title)

  await page.getByTestId('slot-toggle-all').click()
  await expect(page.getByTestId('slot-toggle-all')).toHaveText('Свернуть все')

  const firstDay = dayByDate(page, firstDate)
  await firstDay.getByTestId('slot').first().click()

  await takeSlotViaApi(request, id, startsAt)

  await submitBookingForm(page)

  await expect(page.getByRole('alert')).toContainText('уже занят')
  await expect(firstDay.getByRole('button', { expanded: true })).toBeVisible()
  for (const otherDate of otherDates) {
    const otherDay = dayByDate(page, otherDate)
    await expect(otherDay.getByRole('button', { expanded: false })).toBeVisible()
    await expect(otherDay.getByTestId('slot')).toHaveCount(0)
  }
})

test('guest can collapse the selected day after booking a slot', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request, 30)
  const slots = await listSlots(request, id)
  const startsAt = slots.find((slot) => slot.isAvailable)?.startsAt
  if (!startsAt) throw new Error('No free slots left')
  const date = dayKey(startsAt)

  await openMeetingType(page, title)

  const day = dayByDate(page, date)
  await day.getByTestId('slot').first().click()
  await submitBookingForm(page)
  await expect(page.getByTestId('booking-confirmation')).toBeVisible()

  await expandDayIfCollapsed(page, date)
  await day.getByRole('button', { expanded: true }).click()

  await expect(day.getByRole('button', { expanded: false })).toBeVisible()
  await expect(day.getByTestId('slot')).toHaveCount(0)
})

test('guest can collapse the selected day after a booking conflict', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request, 30)
  const slots = await listSlots(request, id)
  const startsAt = slots.find((slot) => slot.isAvailable)?.startsAt
  if (!startsAt) throw new Error('No free slots left')
  const date = dayKey(startsAt)

  await openMeetingType(page, title)

  const day = dayByDate(page, date)
  await day.getByTestId('slot').first().click()

  await takeSlotViaApi(request, id, startsAt)

  await submitBookingForm(page)
  await expect(page.getByRole('alert')).toContainText('уже занят')

  await expandDayIfCollapsed(page, date)
  await day.getByRole('button', { expanded: true }).click()

  await expect(day.getByRole('button', { expanded: false })).toBeVisible()
  await expect(day.getByTestId('slot')).toHaveCount(0)
})

test('guest keeps manually expanded days while the booking form is open', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request, 30)
  const slots = await listSlots(request, id)
  const firstAvailable = slots.find((slot) => slot.isAvailable)?.startsAt
  const firstDate = firstAvailable ? dayKey(firstAvailable) : undefined
  const secondAvailable = slots.find(
    (slot) => slot.isAvailable && !slot.startsAt.startsWith(firstDate ?? ''),
  )?.startsAt
  const secondDate = secondAvailable ? dayKey(secondAvailable) : undefined
  if (!firstDate || !secondDate) throw new Error('Expected free slots on two days')

  await openMeetingType(page, title)

  const firstDay = dayByDate(page, firstDate)
  const secondDay = dayByDate(page, secondDate)
  await secondDay.getByRole('button', { expanded: false }).click()
  await expect(secondDay.getByTestId('slot').first()).toBeVisible()

  await firstDay.getByTestId('slot').first().click()
  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toBeVisible()
  await expect(secondDay.getByRole('button', { expanded: true })).toBeVisible()
  await expect(secondDay.getByTestId('slot').first()).toBeVisible()

  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toHaveCount(0)
  await expect(secondDay.getByRole('button', { expanded: true })).toBeVisible()
})

test('guest toggles a day with the keyboard', async ({ page, request }) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const slots = await listSlots(request, id)
  const date = slots[0] ? dayKey(slots[0].startsAt) : undefined
  if (!date) throw new Error('No slots returned')

  await openMeetingType(page, title)

  const day = dayByDate(page, date)
  const header = day.getByRole('button', { expanded: true })
  await header.focus()
  await page.keyboard.press('Enter')
  await expect(day.getByRole('button', { expanded: false })).toBeVisible()
  await expect(day.getByTestId('slot')).toHaveCount(0)

  await page.keyboard.press('Space')
  await expect(day.getByRole('button', { expanded: true })).toBeVisible()
  await expect(day.getByTestId('slot').first()).toBeVisible()
})

