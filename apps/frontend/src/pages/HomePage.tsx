import { Button } from '@/components/ui/button'

export function HomePage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-2xl font-semibold">Календарь звонков</h1>
      <p className="text-muted-foreground">
        Забронируйте встречу или управляйте календарём
      </p>
      <div className="flex gap-4">
        <Button asChild>
          <a href="/guest">Бронировать встречу</a>
        </Button>
        <Button asChild variant="outline">
          <a href="/owner">Управление календарём</a>
        </Button>
      </div>
    </main>
  )
}
