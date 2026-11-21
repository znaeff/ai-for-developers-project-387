import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

test('guest selects a meeting type and sees slots grouped by days', async ({ page }) => {
  const title = uniqueTitle('Слоты')

  await createMeetingType(page, {
    title,
    description: 'Свободные слоты для гостя',
    durationMinutes: '30',
  })

  await page.goto('/guest')
  await expect(page.getByRole('heading', { name: 'Выберите тип встречи' })).toBeVisible()

  await page.getByRole('button', { name: new RegExp(title) }).click()

  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

  const days = page.getByTestId('slot-day')
  await expect(days.first()).toBeVisible()
  expect(await days.count()).toBeGreaterThan(0)

  const firstDay = days.first()
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
  await expect(page.getByTestId('slot').first()).toBeDisabled()
})

test('guest books a slot and it becomes unavailable', async ({ page }) => {
  const title = uniqueTitle('Бронирование')

  await createMeetingType(page, {
    title,
    description: 'Встреча с подтверждением',
    durationMinutes: '30',
  })

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

  const firstDay = page.getByTestId('slot-day').first()
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

  const bookedSlot = page
    .getByTestId('slot-day')
    .first()
    .getByTestId('slot')
    .filter({ hasText: slotLabel })

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

  const slotsResponse = await request.get(
    `/api/meeting-types/${meetingType.id}/slots`,
  )
  const slots = (await slotsResponse.json()) as { startsAt: string }[]
  const startsAt = slots[0]?.startsAt
  expect(startsAt).toBeTruthy()

  await page.goto('/guest')
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page.getByRole('heading', { name: 'Свободные слоты' })).toBeVisible()

  const firstDay = page.getByTestId('slot-day').first()
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

