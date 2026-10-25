import { formatYen } from '../../domain/currency'
import type { SearchPriceState } from './search-price'

export function SearchPrice({ state }: { state: SearchPriceState }) {
  if (state.status === 'ready') return <span className="search-price" title={`Yahoo!ショッピングの参考価格${state.fetchedAt ? `・取得 ${state.fetchedAt}` : ''}${state.failed ? '・再確認失敗（前回値）' : state.stale ? '・古い結果（再確認待ち）' : ''}`}>
    <span className="sr-only">{state.price.toLocaleString('ja-JP')}円から</span>
    <span aria-hidden="true">{formatYen(state.price)}～</span>
    {(state.stale || state.failed) && <small>{state.failed ? '前回値・再確認失敗' : '参考・古い結果'}<time dateTime={state.fetchedAt ?? undefined}>{state.fetchedAt ? new Date(state.fetchedAt).toLocaleString('ja-JP') : ''}</time></small>}
  </span>
  const [label, title] = {
    loading: ['価格を確認中', '参考価格を確認しています'],
    pending: ['更新待ち', '未取得または表示可能な結果がありません。完了時刻は保証されません'],
    empty: [state.stale ? '前回は販売情報なし' : '販売情報なし', 'Yahoo!ショッピングの取得対象に一致する販売情報がありません。市場全体の在庫を示しません'],
    unsupported: ['価格取得非対応', '価格取得に対応していない製品です。在庫切れという意味ではありません'],
    missing: ['製品情報を確認できません', 'カタログ製品が存在しないか、現在無効です'],
    error: ['価格を取得できませんでした', '通信または応答形式のエラーです'],
    disabled: ['価格自動取得オフ', '価格取得は無効です。検索・構成編集は利用できます'],
    invalid: ['価格取得の接続設定を確認してください', '価格取得の設定が不正です。検索・構成編集は利用できます'],
  }[state.status]
  return <span className="search-price muted" title={title}>{label}{state.stale && state.status === 'empty' && <small>再確認待ち</small>}{state.failed && <small>再確認失敗・前回結果</small>}</span>
}
