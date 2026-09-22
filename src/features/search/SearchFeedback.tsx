import { useEffect, useState } from 'react'
import { AlertCircle, LoaderCircle, SearchX } from 'lucide-react'
import { CatalogError, catalogErrorMessage } from '../../api/catalog/client'

export function SearchLoading({ waiting = false }: { waiting?: boolean }) {
  return <div className="search-state" role="status"><LoaderCircle size={24} className="spinner" aria-hidden="true" /><p>{waiting ? '入力を待っています…' : '製品を検索しています…'}</p></div>
}

export function SearchEmpty() {
  return <div className="search-state" role="status"><SearchX size={28} aria-hidden="true" /><h3>製品が見つかりませんでした</h3><p>製品名や型番を変えるか、フィルターを減らしてください。<br />検索語とフィルターを解除するとカテゴリの製品一覧を表示します。</p></div>
}

function useRetryWait(error: Error) {
  const [now, setNow] = useState(Date.now)
  const retryAt = error instanceof CatalogError ? error.retryAt : 0
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000))
  useEffect(() => {
    if (retryAt <= Date.now()) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [retryAt])
  return wait
}

export function DynamicFacetError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const wait = useRetryWait(error)
  return <div className="filter-help" role="alert">
    <p>絞り込み候補を更新できませんでした。カテゴリ全体の候補を表示しています。</p>
    <button type="button" className="button secondary" disabled={wait > 0} onClick={onRetry}>{wait > 0 ? `${wait}秒後に候補を再試行できます` : '候補を再試行'}</button>
  </div>
}

export function SearchError({ error, onRetry, title = '検索できませんでした' }: { error: Error; onRetry: () => void; title?: string }) {
  const wait = useRetryWait(error)

  return (
    <div className="search-state" role="alert">
      <AlertCircle size={26} aria-hidden="true" /><h3>{title}</h3>
      <p>{catalogErrorMessage(error)}</p>
      <button type="button" className="button secondary" disabled={wait > 0} onClick={onRetry}>{wait > 0 ? `${wait}秒後に再試行できます` : '再試行'}</button>
      {error instanceof CatalogError && error.requestId && <p className="request-id">お問い合わせ用ID: {error.requestId}</p>}
    </div>
  )
}
