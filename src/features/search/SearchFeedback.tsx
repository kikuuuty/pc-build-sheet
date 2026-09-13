import { useEffect, useState } from 'react'
import { AlertCircle, LoaderCircle, SearchX } from 'lucide-react'
import { CatalogError, catalogErrorMessage } from '../../api/catalog/client'

export function SearchLoading({ waiting = false }: { waiting?: boolean }) {
  return <div className="search-state" role="status"><LoaderCircle size={24} className="spinner" aria-hidden="true" /><p>{waiting ? '入力を待っています…' : '製品を検索しています…'}</p></div>
}

export function SearchEmpty() {
  return <div className="search-state" role="status"><SearchX size={28} aria-hidden="true" /><h3>製品が見つかりませんでした</h3><p>製品名や型番を変えて検索してください。<br />検索欄を空にするとカテゴリの製品一覧を表示します。</p></div>
}

export function SearchError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const [now, setNow] = useState(Date.now)
  const retryAt = error instanceof CatalogError ? error.retryAt : 0
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000))
  useEffect(() => {
    if (retryAt <= Date.now()) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [retryAt])

  return (
    <div className="search-state" role="alert">
      <AlertCircle size={26} aria-hidden="true" /><h3>検索できませんでした</h3>
      <p>{catalogErrorMessage(error)}</p>
      <button type="button" className="button secondary" disabled={wait > 0} onClick={onRetry}>{wait > 0 ? `${wait}秒後に再試行できます` : '再試行'}</button>
      {error instanceof CatalogError && error.requestId && <p className="request-id">お問い合わせ用ID: {error.requestId}</p>}
    </div>
  )
}
