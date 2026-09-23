import { afterEach, describe, expect, it, vi } from 'vitest'
import { offer, offersResponse } from '../../test/offer-fixtures'
import { productOffersResponseSchema, offersSummaryResponseSchema } from './offers'
import { CATALOG_BASE_URL, getProductOffers, getOffersSummary, shouldRetryCatalogRequest, CatalogError } from './client'

afterEach(() => vi.unstubAllGlobals())

describe('Yahoo offer boundary', () => {
  it('validates the full response including image dimensions and leading zero JAN', () => {
    expect(productOffersResponseSchema.parse(offersResponse())).toEqual(offersResponse())
  })
  it('accepts unsupported, empty and nullable optional metadata', () => {
    const unsupported = { ...offersResponse(372, []), lookup: { status: 'unsupported', strategy: null, reason: 'no_supported_identifier' } }
    expect(productOffersResponseSchema.parse(unsupported)).toEqual(unsupported)
    expect(productOffersResponseSchema.parse(offersResponse(372, [])).offers).toEqual([])
    const seller = { ...offer().seller, shop_key: undefined, is_best_seller: null, url: null, image: { id: null, url: null } }
    for (const shipping of [null, { code: null, name: null }]) {
      const result = productOffersResponseSchema.parse(offersResponse(372, [offer({ seller, shipping, image: null })]))
      expect(result.offers[0]).toMatchObject({ shipping, image: null })
    }
    const image = { id: null, small: null, medium: null, preferred: null }
    expect(productOffersResponseSchema.parse(offersResponse(372, [offer({ image })])).offers[0].image).toEqual(image)
  })
  it.each([
    { price: -1 }, { price: 1.5 }, { price: '100' }, { provider: 'amazon' }, { condition: 'used' },
    { fetched_at: 'yesterday' }, { in_stock: null }, { image: { small: { url: 'https://example.com', width: -1 } } },
    { seller: { name: 'shop' } }, { shipping: { name: 2 } },
  ])('rejects malformed offer %j', (patch) => {
    expect(productOffersResponseSchema.safeParse({ ...offersResponse(), offers: [{ ...offer(), ...patch }] }).success).toBe(false)
  })
  it.each(['javascript:alert(1)', 'data:text/html,hello', '//example.com', 'not a URL', 'ftp://example.com'])('rejects external URL %s everywhere', (url) => {
    for (const patch of [
      { url }, { seller: { ...offer().seller, url } },
      { seller: { ...offer().seller, image: { id: null, url } } },
      { image: { ...offer().image, preferred: { url, width: 300, height: 300 } } },
    ]) expect(productOffersResponseSchema.safeParse({ ...offersResponse(), offers: [{ ...offer(), ...patch }] }).success).toBe(false)
  })
  it('GETs only one numeric product and rejects a mismatched product wrapper', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json(offersResponse())))
    vi.stubGlobal('fetch', fetchMock)
    const abort = new AbortController()
    expect(await getProductOffers(372, abort.signal)).toEqual(offersResponse())
    expect(fetchMock).toHaveBeenCalledWith(`${CATALOG_BASE_URL}/v1/products/372/offers`, expect.objectContaining({ credentials: 'omit' }))
    abort.abort()
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    await expect(getProductOffers(373)).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it.each([429, 502, 503])('preserves offer HTTP %i and the existing bounded retry policy', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status, headers: { 'X-Request-ID': 'offer-id', 'Retry-After': '1' } })))
    const error = await getProductOffers(372).catch((error: CatalogError) => error) as CatalogError
    expect(error).toMatchObject({ status, requestId: 'offer-id', kind: 'http' })
    expect(shouldRetryCatalogRequest(0, error)).toBe(true)
    expect(shouldRetryCatalogRequest(1, error)).toBe(false)
  })
  it('POSTs one bulk request for 20 IDs, without individual offers requests', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => i + 1)
    const products = ids.map((id) => ({ id, status: 'complete', lowest_price: 57629, offer_count: 28 }))
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ products })))
    vi.stubGlobal('fetch', fetchMock)
    expect(await getOffersSummary(ids)).toEqual({ products })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${CATALOG_BASE_URL}/v1/products/offers/summary`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ product_ids: ids }) }))
    await expect(getOffersSummary([100])).rejects.toMatchObject({ kind: 'invalid-response' })
  })
  it('rejects inconsistent or duplicate summaries', () => {
    const entry = { id: 372, status: 'complete', lowest_price: 57629, offer_count: 28 }
    for (const products of [[entry, entry], [{ ...entry, offer_count: 0 }], [{ ...entry, status: 'unsupported' }]]) {
      expect(offersSummaryResponseSchema.safeParse({ products }).success).toBe(false)
    }
  })
})
