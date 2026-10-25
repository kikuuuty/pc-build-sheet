import { useState } from 'react'
import type { usePriceSummaries } from '../../api/pricing/queries'
import { needsConfirmation } from '../../api/pricing/schemas'
import { needsSearchPriceRecheck } from './search-price'

export function SearchPriceRecheck({ prices, productCount }: {
  prices: ReturnType<typeof usePriceSummaries>; productCount: number
}) {
  const [requested, setRequested] = useState(false)
  const [focused, setFocused] = useState(false)
  const needed = needsSearchPriceRecheck(prices, productCount)
  // Keep the control in place during the manual request and while it owns focus.
  // Once resolved, Tab/click away removes it without moving focus or scrolling.
  const retained = requested && (prices.isFetching || focused)
  if (prices.availability !== 'enabled' || productCount === 0 || (!needed && !retained)) return null
  const disabled = !prices.canRecheck || prices.isFetching || !needed
  const label = prices.isFetching ? '価格を再確認中'
    : needed ? '価格を再確認'
    : needsConfirmation(prices.data ?? []) ? '自動確認を再開しました' : '価格を確認しました'
  return <div className="search-price-recheck">
    <button type="button" className="text-button" aria-disabled={disabled}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onClick={() => {
        if (disabled) return
        setRequested(true)
        prices.recheck()
      }}>{label}</button>
    {needed && <span>自動確認は停止しました。</span>}
    {needed && prices.waiting && <span title={`再確認可能時刻：${new Date(prices.waitUntil).toLocaleString('ja-JP')}`}>しばらくしてから再確認できます。</span>}
  </div>
}
