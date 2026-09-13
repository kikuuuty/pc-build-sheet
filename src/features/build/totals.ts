import type { BuildItem } from './schemas'

// null is deliberately distinct from a known zero-yen purchase.
export function getItemSubtotal(item: BuildItem): number | null {
  return item.source === 'buy' && item.price !== null ? item.price * item.quantity : null
}

export function getBuildSummary(items: readonly BuildItem[]) {
  return items.reduce((summary, item) => {
    summary.partCount += item.quantity
    if (item.source === 'owned') summary.ownedCount += item.quantity
    else if (item.price === null) summary.unpricedCount += item.quantity
    else summary.purchaseTotal += getItemSubtotal(item)!
    return summary
  }, { partCount: 0, purchaseTotal: 0, ownedCount: 0, unpricedCount: 0 })
}
