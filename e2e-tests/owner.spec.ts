import { expect, test } from './fixtures'

function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

test('owner sees an empty bookings state', async ({ page }) => {
  await page.goto('/owner')

  await expect(page.getByRole('heading', { name: 'Брони', exact: true })).toBeVisible()
  await expect(page.getByText('Пока нет предстоящих встреч.')).toBeVisible()
})

test('owner creates a meeting type and sees it in the list', async ({ page }) => {
  await page.goto('/owner')

  await expect(page.getByRole('heading', { name: 'Управление календарём' })).toBeVisible()

  await page.getByLabel('Название').fill('Консультация')
  await page.getByLabel('Описание').fill('Обсуждение проекта')
  await page.getByLabel('Длительность, минут').selectOption('45')
  await page.getByRole('button', { name: 'Создать тип встречи' }).click()

  const created = page.getByRole('listitem').filter({ hasText: 'Консультация' })
  await expect(created).toBeVisible()
  await expect(created).toContainText('Обсуждение проекта')
  await expect(created).toContainText('45 минут')
})

test('owner sees an error for a duplicate duration', async ({ page }) => {
  const firstTitle = uniqueTitle('Первая встреча')
  const secondTitle = uniqueTitle('Вторая встреча')

  await page.goto('/owner')
  await page.getByLabel('Название').fill(firstTitle)
  await page.getByLabel('Описание').fill('')
  await page.getByLabel('Длительность, минут').selectOption('30')
  await page.getByRole('button', { name: 'Создать тип встречи' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: firstTitle })).toBeVisible()

  await page.getByLabel('Название').fill(secondTitle)
  await page.getByLabel('Описание').fill('')
  await page.getByLabel('Длительность, минут').selectOption('30')
  await page.getByRole('button', { name: 'Создать тип встречи' }).click()

  await expect(page.getByRole('alert')).toContainText('уже существует')
})

test('owner sees a new booking after opening the page', async ({
  context,
  page,
}) => {
  const title = uniqueTitle('Консультация гостя')
  const guestName = 'Пётр'
  const guestEmail = `petr-${Date.now()}@example.com`

  await page.goto('/owner')
  await page.getByLabel('Название').fill(title)
  await page.getByLabel('Описание').fill('Встреча с владельцем')
  await page.getByLabel('Длительность, минут').selectOption('30')
  await page.getByRole('button', { name: 'Создать тип встречи' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: title })).toBeVisible()

  const guestPage = await context.newPage()
  await guestPage.goto('/guest')
  await guestPage.getByRole('button', { name: new RegExp(title) }).click()
  await guestPage.getByTestId('slot').first().click()
  await guestPage.getByLabel('Имя').fill(guestName)
  await guestPage.getByLabel('Почта').fill(guestEmail)
  await guestPage.getByRole('button', { name: 'Забронировать' }).click()
  await expect(guestPage.getByTestId('booking-confirmation')).toContainText(title)
  await guestPage.close()

  await page.goto('/owner')

  const booking = page.getByTestId('booking').filter({ hasText: guestEmail })
  await expect(booking).toBeVisible()
  await expect(booking).toContainText(title)
  await expect(booking).toContainText(guestName)
  await expect(booking).toContainText(/\d{1,2}:\d{2}/)
})

test('owner refreshes the booking list without reloading the page', async ({
  page,
  request,
}) => {
  const title = uniqueTitle('Обновление броней')
  const guestEmail = `refresh-${Date.now()}@example.com`

  await page.goto('/owner')
  await expect(page.getByRole('heading', { name: 'Брони', exact: true })).toBeVisible()

  const created = await request.post('/api/meeting-types', {
    data: { title, description: '', durationMinutes: 30 },
  })
  expect(created.status()).toBe(201)
  const meetingType = (await created.json()) as { id: string }

  const slotsResponse = await request.get(
    `/api/meeting-types/${meetingType.id}/slots`,
  )
  const slots = (await slotsResponse.json()) as { startsAt: string }[]

  const booked = await request.post('/api/bookings', {
    data: {
      meetingTypeId: meetingType.id,
      startsAt: slots[0]?.startsAt,
      guestName: 'Мария',
      guestEmail,
    },
  })
  expect(booked.status()).toBe(201)

  await expect(page.getByTestId('booking').filter({ hasText: guestEmail })).toHaveCount(0)

  await page.getByRole('button', { name: 'Обновить' }).click()

  const booking = page.getByTestId('booking').filter({ hasText: guestEmail })
  await expect(booking).toBeVisible()
  await expect(booking).toContainText(title)
})

test('owner clear button is disabled when there is no data', async ({ page }) => {
  await page.goto('/owner')

  await expect(page.getByText('Пока нет созданных типов встреч.')).toBeVisible()
  await expect(page.getByText('Пока нет предстоящих встреч.')).toBeVisible()
  await expect(page.getByTestId('clear-data')).toBeDisabled()
})

test('owner clears meeting types and bookings', async ({ page, request }) => {
  const title = uniqueTitle('Очистка данных')
  const guestEmail = `clear-${Date.now()}@example.com`

  const created = await request.post('/api/meeting-types', {
    data: { title, description: '', durationMinutes: 30 },
  })
  expect(created.status()).toBe(201)
  const meetingType = (await created.json()) as { id: string }

  const slotsResponse = await request.get(
    `/api/meeting-types/${meetingType.id}/slots`,
  )
  const slots = (await slotsResponse.json()) as { startsAt: string }[]

  const booked = await request.post('/api/bookings', {
    data: {
      meetingTypeId: meetingType.id,
      startsAt: slots[0]?.startsAt,
      guestName: 'Мария',
      guestEmail,
    },
  })
  expect(booked.status()).toBe(201)

  await page.goto('/owner')
  const meetingTypeItem = page
    .getByRole('listitem')
    .filter({ hasText: title })
    .first()
  await expect(meetingTypeItem).toBeVisible()
  await expect(page.getByTestId('booking').filter({ hasText: guestEmail })).toBeVisible()
  await expect(page.getByTestId('clear-data')).toBeEnabled()

  await page.getByTestId('clear-data').click()

  await expect(meetingTypeItem).toHaveCount(0)
  await expect(page.getByTestId('booking').filter({ hasText: guestEmail })).toHaveCount(0)
  await expect(page.getByText('Пока нет созданных типов встреч.')).toBeVisible()
  await expect(page.getByText('Пока нет предстоящих встреч.')).toBeVisible()
  await expect(page.getByTestId('clear-data')).toBeDisabled()

  expect(await (await request.get('/api/meeting-types')).json()).toEqual([])
  expect(await (await request.get('/api/bookings')).json()).toEqual([])
})

test('owner sees a validation error from the API', async ({ page }) => {
  await page.goto('/owner')

  await page.getByLabel('Название').fill('   ')
  await page.getByRole('button', { name: 'Создать тип встречи' }).click()

  await expect(page.getByRole('alert')).toContainText('Название обязательно')
})
