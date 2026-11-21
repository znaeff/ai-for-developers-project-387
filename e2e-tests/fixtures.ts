import { expect, test as base } from '@playwright/test'

type Fixtures = {
  resetState: void
}

export const test = base.extend<Fixtures>({
  resetState: [
    async ({ request }, use) => {
      const response = await request.post('/api/__test__/reset')
      if (!response.ok()) {
        throw new Error(
          `Не удалось сбросить состояние бэкенда: ${response.status()}. ` +
            'Убедитесь, что бэкенд запущен с E2E_RESET=1.',
        )
      }

      await use()
    },
    { auto: true },
  ],
})

export { expect }
