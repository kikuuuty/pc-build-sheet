import type { BuildItem } from './schemas'

export function getBuildSummary(items: readonly BuildItem[]) {
  return items.reduce((summary, item) => {
    summary.partCount += 1
    // null is deliberately distinct from a known zero-yen price.
    if (item.price === null) summary.unpricedCount += 1
    else summary.estimateTotal += item.price
    return summary
  }, { partCount: 0, estimateTotal: 0, unpricedCount: 0 })
}
