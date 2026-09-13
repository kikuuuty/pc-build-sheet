import { MAX_PRICE } from './schemas'

// undefined means invalid, null means intentionally unpriced. No rounding or clamping.
export function parsePriceInput(input: string): number | null | undefined {
  const text = input.normalize('NFKC').trim()
  if (!text) return null
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return undefined
  const value = Number(text.replaceAll(',', ''))
  return Number.isSafeInteger(value) && value <= MAX_PRICE ? value : undefined
}
