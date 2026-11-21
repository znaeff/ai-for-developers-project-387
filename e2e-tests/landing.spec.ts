import { expect, test } from './fixtures'

test('landing page links to the guest and owner pages', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Календарь звонков' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Бронировать встречу' })).toHaveAttribute('href', '/guest')
  await expect(page.getByRole('link', { name: 'Управление календарём' })).toHaveAttribute('href', '/owner')
})

test('role links open the guest and owner pages and return home', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('link', { name: 'Бронировать встречу' }).click()
  await expect(page).toHaveURL(/\/guest$/)
  await expect(page.getByRole('heading', { name: 'Бронировать встречу' })).toBeVisible()

  await page.getByRole('link', { name: 'На главную' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('link', { name: 'Управление календарём' }).click()
  await expect(page).toHaveURL(/\/owner$/)
  await expect(page.getByRole('heading', { name: 'Управление календарём' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Создать тип встречи' })).toBeVisible()
})
