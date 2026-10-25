import { z } from 'zod'

// Plain JSON contract: pc-parts-pricing a3ac223ae9756ab813e3a080ea7e468c66f49832.
export const productRefSchema = z.strictObject({
  source: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/).refine((value) => !/[^\x21-\x7e]/.test(value)),
  upstream_key: z.string().max(200).regex(/^[-A-Za-z0-9_]+\/[-A-Za-z0-9_.]+$/)
    .refine((key) => !/[^\x21-\x7e]/.test(key) && !['.', '..'].includes(key.split('/')[1])),
})
export type ProductRef = z.infer<typeof productRefSchema>
const date = z.iso.datetime({ offset: true })
const common = { provider: z.literal('yahoo'), stale: z.boolean() }
export const summarySchema = z.discriminatedUnion('status', [
  z.object({ ...common, status: z.literal('complete'), lowest_price: z.number().int().positive(),
    offer_count: z.number().int().positive(), fetched_at: date, expires_at: date }),
  z.object({ ...common, status: z.literal('empty'), lowest_price: z.null(),
    offer_count: z.literal(0), fetched_at: date, expires_at: date }),
  z.object({ ...common, status: z.literal('unsupported'), lowest_price: z.null(),
    offer_count: z.literal(0), fetched_at: z.null(), expires_at: date }),
  z.object({ ...common, status: z.literal('missing'), lowest_price: z.null(),
    offer_count: z.literal(0), fetched_at: z.null(), expires_at: date }),
  z.object({ ...common, status: z.literal('pending'), lowest_price: z.null(),
    offer_count: z.null(), fetched_at: z.null(), expires_at: date.nullable() }),
])
export type Summary = z.infer<typeof summarySchema>
export const responseSchema = z.object({ ok: z.literal(true), data: z.array(productRefSchema.extend({
  providers: z.strictObject({ yahoo: summarySchema }),
})).min(1).max(100) })

// Provider maps stay at the API boundary. UI receives only this Yahoo display model.
export type PriceSummary = ProductRef & {
  status: Summary['status']; price: number | null; fetchedAt: string | null
  expiresAt: string | null; stale: boolean; attribution: string
}
export const refKey = (ref: ProductRef) => JSON.stringify([ref.source, ref.upstream_key])
export function normalizeRefs(refs: ProductRef[]): ProductRef[] {
  return [...new Map(refs.map(({ source, upstream_key }) => {
    const ref = { source, upstream_key }
    return [refKey(ref), ref] as const
  })).values()].sort((a, b) => refKey(a) < refKey(b) ? -1 : refKey(a) > refKey(b) ? 1 : 0)
}
export function isOld(summary: PriceSummary, now = Date.now()) {
  return summary.stale || (summary.expiresAt !== null && Date.parse(summary.expiresAt) <= now)
}
export function needsConfirmation(data: PriceSummary[], now = Date.now()) {
  return data.some((s) => s.status === 'pending' || (['complete', 'empty'].includes(s.status) && isOld(s, now)))
}
