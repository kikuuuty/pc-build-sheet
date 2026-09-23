import { useEffect, useState } from 'react'
import { AlertCircle, Clock3, LoaderCircle, SearchX } from 'lucide-react'
import { CatalogError, catalogErrorMessage } from '../../api/catalog/client'
import type { CatalogRetryProgress } from '../../api/catalog/query-options'

export function SearchLoading({ waiting = false, label = '製品を検索しています…' }: { waiting?: boolean; label?: string }) {
  return <div className="search-state" role="status"><LoaderCircle size={24} className="spinner" aria-hidden="true" /><p>{waiting ? '入力を待っています…' : label}</p></div>
}

export function SearchEmpty() {
  return <div className="search-state" role="status"><SearchX size={28} aria-hidden="true" /><h3>製品が見つかりませんでした</h3><p>製品名や型番を変えるか、フィルターを減らしてください。<br />検索語とフィルターを解除するとカテゴリの製品一覧を表示します。</p></div>
}

function useRetryWait(retryAt: number) {
  const [now, setNow] = useState(Date.now)
  const wait = Math.max(0, Math.ceil((retryAt - now) / 1000))
  useEffect(() => {
    if (retryAt <= Date.now()) return
    const interval = window.setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time >= retryAt) window.clearInterval(interval)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [retryAt])
  return wait
}

export function CatalogRetryStatus({ progress, subject, compact = false, paused = false }: {
  progress: CatalogRetryProgress; subject: string; compact?: boolean; paused?: boolean
}) {
  const wait = useRetryWait(progress.phase === 'waiting' ? progress.retryAt : 0)
  const retrying = progress.phase === 'retrying' && !paused
  const message = paused ? 'APIの利用制限後の自動再試行を一時停止しています。通信が再開できる状態になるまでお待ちください。'
    : retrying ? '自動再試行しています…'
    : wait > 0 ? `APIの利用制限に達しています。あと${wait}秒で自動再試行します。`
    : 'APIの利用制限により、自動再試行の開始を待っています…'
  return <div className={compact ? 'filter-help' : 'search-state'} role="status" aria-label={`${subject}の再試行状況`}>
    {retrying ? <LoaderCircle size={compact ? 16 : 24} className="spinner" aria-hidden="true" /> : <Clock3 size={compact ? 16 : 24} aria-hidden="true" />}
    <p>{subject}：{message}</p>
  </div>
}

export function DynamicFacetError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const wait = useRetryWait(error instanceof CatalogError ? error.retryAt : 0)
  return <div className="filter-help" role="alert">
    <p>絞り込み候補を更新できませんでした。カテゴリ全体の候補を表示しています。</p>
    <button type="button" className="button secondary" disabled={wait > 0} onClick={onRetry}>{wait > 0 ? `${wait}秒後に候補を再試行できます` : '候補を再試行'}</button>
  </div>
}

export function SearchError({ error, onRetry, title = '検索できませんでした' }: { error: Error; onRetry: () => void; title?: string }) {
  const wait = useRetryWait(error instanceof CatalogError ? error.retryAt : 0)

  return (
    <div className="search-state" role="alert">
      <AlertCircle size={26} aria-hidden="true" /><h3>{title}</h3>
      <p>{catalogErrorMessage(error)}</p>
      <button type="button" className="button secondary" disabled={wait > 0} onClick={onRetry}>{wait > 0 ? `${wait}秒後に再試行できます` : '再試行'}</button>
      {error instanceof CatalogError && error.requestId && <p className="request-id">お問い合わせ用ID: {error.requestId}</p>}
    </div>
  )
}
