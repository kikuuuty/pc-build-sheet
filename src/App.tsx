import { useState } from 'react'
import { Check, Monitor, AlertCircle } from 'lucide-react'
import type { CategoryDefinition } from './domain/categories'
import { Attribution } from './components/Attribution'
import { BuildSheet } from './features/build/BuildSheet'
import { BuildSummary } from './features/build/BuildSummary'
import { usePersistenceStatus } from './features/build/store'
import { ProductSearchDrawer } from './features/search/ProductSearchDrawer'

export function App() {
  const [category, setCategory] = useState<CategoryDefinition | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const persistenceIssue = usePersistenceStatus((state) => state.issue)

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <div className="brand"><span className="brand-icon"><Monitor size={22} aria-hidden="true" /></span><div><h1>自作PC構成シート</h1><p>パーツを選んで、シンプルにPC構成を作成</p></div></div>
          <span className="save-status">{persistenceIssue ? <AlertCircle size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{persistenceIssue ? '保存を確認' : 'ブラウザに自動保存'}</span>
        </div>
      </header>
      <main className="app-main">
        <div className="page-heading"><div><p className="eyebrow">BUILD SHEET</p><h2>マイ構成</h2></div><p>ひとつずつ選んで、理想の1台に。</p></div>
        {persistenceIssue && <p className="storage-warning" role="alert">{persistenceIssue}</p>}
        <div className="workspace"><BuildSheet onSelect={setCategory} /><BuildSummary /></div>
        <footer className="app-footer"><span>自作PC構成シート</span><Attribution /></footer>
      </main>
      <div className="sr-only" role="status">{announcement}</div>
      {category && <ProductSearchDrawer key={category.id} category={category} onClose={() => setCategory(null)} onAdded={(name) => { setAnnouncement(`${name}を構成に追加しました`); setCategory(null) }} />}
    </>
  )
}
