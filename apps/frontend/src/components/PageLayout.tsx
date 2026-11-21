import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

type PageLayoutProps = {
  title: string
  subtitle?: string
  children: ReactNode
}

export function PageLayout({ title, subtitle, children }: PageLayoutProps) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle ? <p className="text-muted-foreground">{subtitle}</p> : null}
        </div>
        <Button asChild variant="outline">
          <a href="/">На главную</a>
        </Button>
      </header>
      {children}
    </main>
  )
}
