import { useEffect, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { readPricingConfig, type PricingConfig } from './config'
import { getPricingSession } from './control'
import { validateRefs } from './client'
import type { ProductRef } from './schemas'

export function usePriceSummaries(input: ProductRef[], config: PricingConfig = readPricingConfig()) {
  const client = useQueryClient()
  let refs: ProductRef[] = []
  let inputInvalid = false
  try { refs = validateRefs(input) } catch { inputInvalid = true }
  const session = getPricingSession(client, config.status === 'enabled' ? config.baseUrl : '', refs)
  useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot)
  const query = useQuery(session.options())
  const enabled = config.status === 'enabled' && !inputInvalid && refs.length > 0
  useEffect(() => enabled ? session.activate() : undefined, [session, enabled])
  return {
    data: enabled ? query.data : undefined,
    isPending: query.isPending, isError: enabled && query.isError, isFetching: enabled && query.isFetching,
    error: enabled ? query.error : null,
    availability: inputInvalid ? 'invalid' as const : config.status,
    stopped: session.stopped || session.exhausted,
    waiting: session.waiting, waitUntil: session.waitUntil,
    canRecheck: enabled && session.manualAllowed, recheck: session.manual,
  }
}
