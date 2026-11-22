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

test('guest sees only the nearest day with free slots expanded', async ({
  page,
  request,
}) => {
  const { id, title } = await createMeetingTypeViaApi(request)
  const initialSlots = await listSlots(request, id)
  const firstDate = initialSlots[0]?.startsAt.slice(0, 10)
  if (!firstDate) throw new Error('No slots returned')

  await bookAllAvailableInDay(request, id, firstDate)

  const remainingSlots = await listSlots(request, id)
  const nextDate = remainingSlots.find((slot) => slot.isAvailable)?.startsAt.slice(0, 10)
  if (!nextDate) throw new Error('No free slots left')

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

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
  const dates = [...new Set(slots.map((slot) => slot.startsAt.slice(0, 10)))]
  if (dates.length < 2) throw new Error('Expected at least two days')
  const [firstDate, secondDate] = dates

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

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
  const dates = [...new Set(slots.map((slot) => slot.startsAt.slice(0, 10)))]
  if (dates.length < 2) throw new Error('Expected at least two days')

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

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
  const dates = [...new Set(slots.map((slot) => slot.startsAt.slice(0, 10)))]
  if (dates.length < 2) throw new Error('Expected at least two days')

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

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
  const dates = [...new Set(slots.map((slot) => slot.startsAt.slice(0, 10)))]
  if (dates.length < 2) throw new Error('Expected at least two days')
  const [firstDate, secondDate] = dates

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

  const firstDay = dayByDate(page, firstDate)
  const secondDay = dayByDate(page, secondDate)
  await firstDay.getByRole('button', { expanded: true }).click()
  await secondDay.getByRole('button', { expanded: false }).click()
  await expect(firstDay.getByRole('button', { expanded: false })).toBeVisible()
  await expect(secondDay.getByRole('button', { expanded: true })).toBeVisible()

  await page.getByRole('button', { name: 'Выбрать другой тип' }).click()
  await page.getByRole('button', { name: new RegExp(title) }).click()
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

  const meetingTypesResponse = await request.get('/api/meeting-types')
  const meetingTypes = (await meetingTypesResponse.json()) as Array<{
    id: string
    title: string
  }>
  const meetingType = meetingTypes.find((item) => item.title === title)
  if (!meetingType) throw new Error(`Meeting type ${title} was not created`)
  const slots = await listSlots(request, meetingType.id)
  const firstDate = slots[0]?.startsAt.slice(0, 10)
  if (!firstDate) throw new Error('No slots returned')

  await page.goto('/guest')
  await expect(page.getByRole('heading', { name: 'Выберите тип встречи' })).toBeVisible()

  await page.getByRole('button', { name: new RegExp(title) }).click()

  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

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

  const typesResponse = await request.get('/api/meeting-types')
  const meetingTypes = (await typesResponse.json()) as Array<{
    id: string
    title: string
  }>
  const meetingType = meetingTypes.find((item) => item.title === title)

  if (!meetingType) {
    throw new Error(`Meeting type ${title} was not created`)
  }

  let slotsResponse = await request.get(
    `/api/meeting-types/${meetingType.id}/slots`,
  )
  let slots = ((await slotsResponse.json()) as Array<{
    startsAt: string
    isAvailable: boolean
  }>).filter((slot) => slot.isAvailable)
  const firstDate = slots[0]?.startsAt.slice(0, 10)
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
    slots = ((await slotsResponse.json()) as Array<{
      startsAt: string
      isAvailable: boolean
    }>).filter((slot) => slot.isAvailable)
  }

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()

  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()
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

test('guest books a slot and it becomes unavailable', async ({
  page,
  request,
}) => {
  const title = uniqueTitle('Бронирование')

  await createMeetingType(page, {
    title,
    description: 'Встреча с подтверждением',
    durationMinutes: '30',
  })

  const meetingTypesResponse = await request.get('/api/meeting-types')
  const meetingTypes = (await meetingTypesResponse.json()) as Array<{
    id: string
    title: string
  }>
  const meetingType = meetingTypes.find((item) => item.title === title)
  if (!meetingType) throw new Error(`Meeting type ${title} was not created`)
  const slots = await listSlots(request, meetingType.id)
  const firstDate = slots[0]?.startsAt.slice(0, 10)
  if (!firstDate) throw new Error('No slots returned')

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

  const firstDay = dayByDate(page, firstDate)
  const slot = firstDay.getByTestId('slot').first()
  const slotLabel = (await slot.innerText()).trim()

  await slot.click()

  await expect(page.getByRole('heading', { name: 'Данные гостя' })).toBeVisible()
  await page.getByLabel('Имя').fill('Анна')
  await page.getByLabel('Почта').fill('anna@example.com')
  await page.getByRole('button', { name: 'Забронировать' }).click()

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
  const firstDate = startsAt?.slice(0, 10)
  if (!firstDate) throw new Error('No slots returned')

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

  const firstDay = dayByDate(page, firstDate)
  const firstSlot = firstDay.getByTestId('slot').first()
  const slotLabel = (await firstSlot.innerText()).trim()
  await firstSlot.click()

  const taken = await request.post('/api/bookings', {
    data: {
      meetingTypeId: meetingType.id,
      startsAt,
      guestName: 'Другой гость',
      guestEmail: 'other@example.com',
    },
  })
  expect(taken.status()).toBe(201)

  await page.getByLabel('Имя').fill('Анна')
  await page.getByLabel('Почта').fill('anna@example.com')
  await page.getByRole('button', { name: 'Забронировать' }).click()

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

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await page.getByTestId('slot').first().click()

  await page.getByLabel('Почта').fill('anna@example.com')
  await page.getByRole('button', { name: 'Забронировать' }).click()
  await expect(page.getByRole('alert')).toContainText('Имя обязательно')

  await page.getByLabel('Имя').fill('Анна')
  await page.getByLabel('Почта').fill('anna@')
  await page.getByRole('button', { name: 'Забронировать' }).click()
  await expect(page.getByRole('alert')).toContainText('Почта')
})

