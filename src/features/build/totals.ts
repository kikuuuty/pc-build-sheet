import type { BuildItem } from './schemas'

// null is deliberately distinct from a known zero-yen price.
export function getItemSubtotal(item: BuildItem): number | null {
  return item.price !== null ? item.price * item.quantity : null
}

export function getBuildSummary(items: readonly BuildItem[]) {
  return items.reduce((summary, item) => {
    summary.partCount += item.quantity
    if (item.price === null) summary.unpricedCount += item.quantity
    else summary.estimateTotal += getItemSubtotal(item)!
    return summary
  }, { partCount: 0, estimateTotal: 0, unpricedCount: 0 })
}
