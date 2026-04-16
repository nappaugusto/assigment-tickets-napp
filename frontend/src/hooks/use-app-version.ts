import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ticketsApi } from '@/lib/api'

export function useAppVersion() {
  const baselineRef = useRef<string | null>(null)
  const [outdated, setOutdated] = useState(false)

  const { data } = useQuery({
    queryKey: ['app-version'],
    queryFn: ticketsApi.appVersion,
    refetchInterval: 60_000,
    retry: false,
    staleTime: 60_000,
  })

  useEffect(() => {
    const version = data?.version
    if (!version) return
    if (!baselineRef.current) {
      baselineRef.current = version
      return
    }
    if (version !== baselineRef.current && !outdated) {
      setOutdated(true)
      toast.info('Nova versão disponível. Recarregando…', {
        duration: 4000,
        action: { label: 'Recarregar', onClick: () => window.location.reload() },
      })
      setTimeout(() => window.location.reload(), 5000)
    }
  }, [data])

  return { outdated }
}
