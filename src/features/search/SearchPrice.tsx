import { formatYen } from '../../domain/currency'
import type { SearchPriceState } from './search-price'

export function SearchPrice({ state }: { state: SearchPriceState }) {
  if (state.status === 'ready') return <span className="search-price" title="Yahoo!ショッピングの最安価格">
    <span className="sr-only">{state.price.toLocaleString('ja-JP')}円から</span>
    <span aria-hidden="true">{formatYen(state.price)}～</span>
  </span>
  const label = { loading: '価格取得中…', empty: '価格情報なし', error: '価格取得失敗', unavailable: '価格情報なし' }[state.status]
  return <span className="search-price muted" title={state.status === 'unavailable' ? '一覧価格は一括価格APIの提供待ちです' : undefined}>{label}</span>
}
