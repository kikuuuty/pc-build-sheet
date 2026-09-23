import { z } from 'zod'

// pc-parts-catalog docs/product-offers.md (2026-09-23).
const externalUrl = z.httpUrl()
const price = z.number().int().positive()
const imageVariant = z.object({
  url: externalUrl,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
}).nullable()

export const productOfferSchema = z.object({
  provider: z.literal('yahoo'),
  provider_item_id: z.string().min(1),
  name: z.string().min(1),
  jan_code: z.string().regex(/^(?:\d{8}|\d{13})$/),
  image: z.object({ id: z.string().nullable(), small: imageVariant, medium: imageVariant, preferred: imageVariant }).nullable(),
  seller: z.object({
    id: z.string().min(1), name: z.string().min(1), url: externalUrl.nullable(),
    is_best_seller: z.boolean().nullable(), shop_key: z.string().min(1).optional(),
    image: z.object({ id: z.string().nullable(), url: externalUrl.nullable() }),
  }),
  price,
  shipping: z.object({ code: z.number().int().nullable(), name: z.string().nullable() }).nullable(),
  in_stock: z.boolean(), condition: z.literal('new'),
  url: externalUrl, fetched_at: z.iso.datetime(),
})

export const productOffersResponseSchema = z.object({
  product: z.object({ id: z.number().int().positive(), name: z.string().min(1) }),
  provider: z.literal('yahoo'),
  lookup: z.discriminatedUnion('status', [
    z.object({ status: z.literal('complete'), strategy: z.enum(['jan', 'ean13_as_jan']), reason: z.null() }),
    z.object({ status: z.literal('unsupported'), strategy: z.null(), reason: z.literal('no_supported_identifier') }),
  ]),
  offers: z.array(productOfferSchema),
}).refine(({ lookup, offers }) => lookup.status !== 'unsupported' || offers.length === 0)

// PROVISIONAL bulk contract, disabled by default until the backend publishes it.
// This boundary must never fall back to a per-product /offers fan-out.
export const offerSummarySchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(['complete', 'unsupported', 'pending', 'error']),
  lowest_price: price.nullable(),
  offer_count: z.number().int().nonnegative(),
}).refine((entry) => entry.status === 'complete'
  ? (entry.offer_count === 0 ? entry.lowest_price === null : entry.lowest_price !== null)
  : entry.lowest_price === null && entry.offer_count === 0)

export const offersSummaryResponseSchema = z.object({ products: z.array(offerSummarySchema) })
  .refine(({ products }) => new Set(products.map(({ id }) => id)).size === products.length)
