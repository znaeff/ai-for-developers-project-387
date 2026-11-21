import {
  useEffect,
  useState,
  type DependencyList,
  type Dispatch,
  type SetStateAction,
} from 'react'

type ApiResource<T> = {
  data: T | null
  isLoading: boolean
  error: string | null
  setData: Dispatch<SetStateAction<T | null>>
}

type ApiResourceOptions = {
  fallbackError: string
  enabled?: boolean
  resetKey?: unknown
}

export function useApiResource<T>(
  load: () => Promise<T>,
  deps: DependencyList,
  options: ApiResourceOptions,
): ApiResource<T> {
  const enabled = options.enabled ?? true
  const resetKey = options.resetKey
  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [activeResetKey, setActiveResetKey] = useState(resetKey)

  if (resetKey !== activeResetKey) {
    setActiveResetKey(resetKey)
    setData(null)
    setError(null)
    setIsLoading(enabled)
  }

  useEffect(() => {
    if (!enabled) {
      setData(null)
      setError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    load()
      .then((loaded) => {
        if (!cancelled) setData(loaded)
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : options.fallbackError,
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [...deps, enabled, resetKey])

  return { data, isLoading, error, setData }
}
