const yenFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 })

export function formatYen(value: number): string {
  return yenFormatter.format(value)
}
