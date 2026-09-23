import { useState } from 'react'
import { Check, Monitor, AlertCircle } from 'lucide-react'
import { Attribution } from './components/Attribution'
import { BuildSheet } from './features/build/BuildSheet'
import { BuildSummary } from './features/build/BuildSummary'
import { ProductAdditionPanel } from './features/build/ProductAdditionPanel'
import { useOptionalCategoryFocus } from './features/build/category-focus'
import { usePersistenceStatus } from './features/build/store'
import { ProductSearchDialog, type SearchRequest } from './features/search/ProductSearchDialog'

export function App() {
  const [search, setSearch] = useState<SearchRequest | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const persistenceIssue = usePersistenceStatus((state) => state.issue)
  const optionalRefs = useOptionalCategoryFocus()

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <div className="brand"><span className="brand-icon"><Monitor size={22} aria-hidden="true" /></span><h1>自作PC構成シート</h1></div>
          <span className="save-status">{persistenceIssue ? <AlertCircle size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{persistenceIssue ? '保存を確認' : 'ブラウザに自動保存'}</span>
        </div>
      </header>
      <main className="app-main">
        <div className="page-heading"><h2>マイ構成</h2></div>
        {persistenceIssue && <p className="storage-warning" role="alert">{persistenceIssue}</p>}
        <div className="workspace">
          <BuildSheet onSearch={setSearch} optionalRefs={optionalRefs} />
          <div className="workspace-sidebar">
            <BuildSummary />
            <ProductAdditionPanel onSearch={setSearch} optionalRefs={optionalRefs} />
          </div>
        </div>
        <footer className="app-footer"><span>自作PC構成シート</span><Attribution /></footer>
      </main>
      <div className="sr-only" role="status">{announcement}</div>
      {search && <ProductSearchDialog {...search} onClose={() => setSearch(null)} onSelected={(name) => { setAnnouncement(`${name}${search.target.mode === 'add' ? 'を構成に追加しました' : 'に置き換えました。価格は未入力に戻りました'}`); setSearch(null) }} />}
    </>
  )
}
