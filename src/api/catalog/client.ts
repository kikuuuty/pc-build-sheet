import { z } from 'zod'
import { categoriesResponseSchema, searchResponseSchema } from './schemas'
import { productOffersResponseSchema, offersSummaryResponseSchema } from './offers'
import type { SearchParams } from './types'
import type { PartCategory } from '../../domain/categories'
import { conditionsLimitError, dynamicFacetResponseSchema, filtersResponseSchema, hasSearchConditions, typedConditions, type SearchConditions } from './filters'

export const CATALOG_BASE_URL = 'https://pc-parts-catalog.kikuuuty.workers.dev'
export const SEARCH_PAGE_SIZE = 20
const REQUEST_TIMEOUT_MS = 15_000

type ErrorKind = 'network' | 'http' | 'invalid-response' | 'timeout'

export class CatalogError extends Error {
  readonly kind: ErrorKind
  readonly status?: number
  readonly requestId?: string
  readonly retryAt: number

  constructor(kind: ErrorKind, options: { status?: number; requestId?: string; retryAt?: number } = {}) {
    super(`Catalog request failed: ${kind}`)
    this.name = 'CatalogError'
    this.kind = kind
    this.status = options.status
    this.requestId = options.requestId
    this.retryAt = options.retryAt ?? 0
  }
}

function retryAfterTime(value: string | null): number {
  if (!value) return 0
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Date.now() + seconds * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? 0 : date
}

async function request<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal, body?: unknown): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetch(`${CATALOG_BASE_URL}${path}`, {
      signal: combinedSignal,
      credentials: 'omit',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new CatalogError(timeout.aborted ? 'timeout' : 'network')
  }
  const requestId = response.headers.get('X-Request-ID') ?? undefined
  if (!response.ok) {
    throw new CatalogError('http', {
      status: response.status, requestId,
      retryAt: retryAfterTime(response.headers.get('Retry-After')),
    })
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    if (signal?.aborted) throw error
    if (timeout.aborted) throw new CatalogError('timeout', { requestId })
    throw new CatalogError('invalid-response', { requestId })
  }
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new CatalogError('invalid-response', { requestId })
  return parsed.data
}

export function getCategories(signal?: AbortSignal) {
  return request('/v1/categories', categoriesResponseSchema, signal)
}

export async function getProductOffers(productId: number, signal?: AbortSignal) {
  const result = await request(`/v1/products/${productId}/offers`, productOffersResponseSchema, signal)
  if (result.product.id !== productId) throw new CatalogError('invalid-response')
  return result
}

export async function getOffersSummary(productIds: number[], signal?: AbortSignal) {
  const result = await request('/v1/products/offers/summary', offersSummaryResponseSchema, signal, { product_ids: productIds })
  if (result.products.length !== productIds.length || result.products.some(({ id }) => !productIds.includes(id))) {
    throw new CatalogError('invalid-response')
  }
  return result
}

export async function getCategoryFilters(category: PartCategory, signal?: AbortSignal) {
  const result = await request(`/v1/categories/${category}/filters`, filtersResponseSchema, signal)
  if (result.category !== category) throw new CatalogError('invalid-response')
  return result
}

export async function getDynamicFacets(category: PartCategory, conditions: SearchConditions, signal?: AbortSignal) {
  const body = typedConditions(conditions)
  if (conditionsLimitError(body)) throw new CatalogError('http', { status: 400 })
  const result = await request(`/v1/categories/${category}/facets`, dynamicFacetResponseSchema, signal, body)
  if (result.category !== category) throw new CatalogError('invalid-response')
  return result
}

export async function searchProducts(search: SearchParams, signal?: AbortSignal) {
  const { category } = search
  const params = new URLSearchParams({ category, limit: String(SEARCH_PAGE_SIZE) })
  if (search.mode === 'keyword') {
    // Callers select listing mode for empty input; never silently reuse its offset.
    if (!search.query.trim()) throw new Error('Keyword search requires a nonempty query')
    params.set('q', search.query.trim())
    params.set('offset', String(search.offset ?? 0))
  } else if (search.cursor !== undefined) params.set('cursor', search.cursor)
  const conditions = search.conditions ?? {}
  if (conditionsLimitError(conditions)) throw new CatalogError('http', { status: 400 })
  const advanced = hasSearchConditions(conditions)
  const result = advanced
    ? await request('/v1/search', searchResponseSchema, signal, {
      category, limit: SEARCH_PAGE_SIZE, ...conditions,
      ...(search.mode === 'keyword' ? { keyword: search.query.trim(), offset: search.offset ?? 0 }
        : search.cursor === undefined ? {} : { cursor: search.cursor }),
    })
    : await request(`/v1/search?${params}`, searchResponseSchema, signal)
  // Listing metadata always has offset=0, including subsequent cursor pages.
  const expectedOffset = search.mode === 'keyword' ? search.offset ?? 0 : 0
  if (result.data.some((product) => product.category !== category)
    || result.meta.offset !== expectedOffset || result.meta.limit !== SEARCH_PAGE_SIZE) {
    throw new CatalogError('invalid-response')
  }
  return result
}

export function shouldRetryCatalogRequest(failureCount: number, error: Error) {
  if (!(error instanceof CatalogError) || failureCount >= 1 || error.retryAt - Date.now() > 60_000) return false
  return error.kind === 'network' || error.kind === 'timeout'
    || (error.status !== undefined && [429, 502, 503, 504].includes(error.status))
}

export function catalogRetryDelay(attempt: number, error: Error) {
  const backoff = 1000 * 2 ** attempt + Math.random() * 300
  return Math.max(backoff, error instanceof CatalogError ? error.retryAt - Date.now() : 0)
}

export function catalogErrorMessage(error: Error): string {
  if (!(error instanceof CatalogError)) return '製品を取得できませんでした。しばらくしてから再試行してください。'
  if (error.kind === 'invalid-response') return '製品データの形式を確認できませんでした。しばらくしてから再試行してください。'
  if (error.kind === 'network') return 'APIに接続できませんでした。インターネット接続を確認して再試行してください。'
  if (error.kind === 'timeout') return '検索に時間がかかっています。しばらくしてから再試行してください。'
  if (error.status === 400) return '検索条件を確認してください。製品名や型番を短く入力すると検索できます。'
  if (error.status === 429) return '検索が混み合っています。少し待ってから再試行してください。'
  return 'カタログAPIでエラーが発生しました。しばらくしてから再試行してください。'
}
