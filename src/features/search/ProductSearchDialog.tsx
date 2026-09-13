import { useRef, useState } from 'react'
import { Plus, Search, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useCatalogCategories, useProductSearch } from '../../api/catalog/queries'
import type { CategoryDefinition } from '../../domain/categories'
import type { CatalogProduct } from '../../api/catalog/types'
import { productSpecSummary } from '../../domain/product-summary'
import { Dialog } from '../../components/Dialog'
import { Attribution } from '../../components/Attribution'
import { useBuildStore } from '../build/store'
import { SearchEmpty, SearchError, SearchLoading } from './SearchFeedback'
import { useDebouncedValue } from './useDebouncedValue'

type Props = { category: CategoryDefinition; onClose: () => void; onAdded: (name: string) => void }

export function ProductSearchDialog({ category, onClose, onAdded }: Props) {
  const [input, setInput] = useState('')
  const [composing, setComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const query = input.trim()
  const debounced = useDebouncedValue(query)
  const categories = useCatalogCategories()
  const waiting = composing || query !== debounced

  return (
    <Dialog variant="wide" title={`${category.label}を選択`} titleId="search-title" onClose={onClose} initialFocus={inputRef}>
      <div className="search-controls">
        <label className="search-label" htmlFor="product-search">製品名・型番で検索</label>
        <div className="search-input-wrapper">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} id="product-search" className="search-input" type="text" inputMode="search" autoComplete="off" spellCheck={false} maxLength={200}
            placeholder="メーカー名、製品名、型番など" value={input}
            onChange={(event) => setInput(event.target.value)}
            onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          />
          {input && <button type="button" className="icon-button clear-search" aria-label="検索語をクリア" onClick={() => { setInput(''); inputRef.current?.focus() }}><X size={17} aria-hidden="true" /></button>}
        </div>
        <p className="search-hint">{category.label}のカタログから検索します。空欄でも検索できます。</p>
      </div>
      {categories.isPending ? <div className="search-body"><SearchLoading /></div>
        : categories.isError ? <div className="search-body"><SearchError error={categories.error} onRetry={() => { void categories.refetch() }} /></div>
        : !categories.data.categories.includes(category.id) ? <div className="search-body"><p className="search-state">このカテゴリは現在カタログで利用できません。</p></div>
        : waiting ? <div className="search-body"><SearchLoading waiting /></div>
        : <SearchResults key={debounced} category={category} query={debounced} onAdded={onAdded} />}
    </Dialog>
  )
}

function SearchResults({ category, query, onAdded }: Pick<Props, 'category' | 'onAdded'> & { query: string }) {
  const [offsets, setOffsets] = useState([0])
  const offset = offsets[offsets.length - 1]
  const search = useProductSearch({ category: category.id, query, offset })
  const addItem = useBuildStore((state) => state.addItem)
  const scrollRef = useRef<HTMLDivElement>(null)
  function add(product: CatalogProduct) { addItem(product); onAdded(product.name) }
  function changePage(next: number[]) { setOffsets(next); scrollRef.current?.scrollTo({ top: 0 }) }

  return (
    <>
      <div className="search-body" ref={scrollRef} aria-busy={search.isFetching}>
        {search.isPending ? <SearchLoading /> : search.isError ? <SearchError error={search.error} onRetry={() => { void search.refetch() }} /> : (
          <>
            <div className="search-result-count" role="status"><span>{query ? `「${query}」の検索結果` : `${category.label}の製品一覧`}</span><span>{search.data.meta.returned}件表示</span></div>
            {search.data.data.length === 0 ? <SearchEmpty /> : (
              <ul className="search-results">
                {search.data.data.map((product) => (
                  <li className="search-result" key={product.upstream_key}>
                    <div className="product-info"><p className="product-name">{product.name}</p><p className="product-details">{product.manufacturer ?? 'メーカー情報なし'}</p><p className="product-details">{productSpecSummary(product) || '主要スペック情報なし'}</p></div>
                    <button type="button" className="button primary add-product" aria-label={`${product.name}を構成に追加`} onClick={() => add(product)}><Plus size={15} aria-hidden="true" />追加</button>
                  </li>
                ))}
              </ul>
            )}
            {(offset > 0 || search.data.meta.next_offset !== null) && (
              <nav className="pagination" aria-label="検索結果のページ">
                <button type="button" className="button secondary" disabled={offsets.length === 1 || search.isFetching} onClick={() => changePage(offsets.slice(0, -1))}><ChevronLeft size={15} aria-hidden="true" />前へ</button>
                <span>{offsets.length}ページ</span>
                <button type="button" className="button secondary" disabled={search.data.meta.next_offset === null || search.isFetching} onClick={() => { if (search.data.meta.next_offset !== null) changePage([...offsets, search.data.meta.next_offset]) }}>次へ<ChevronRight size={15} aria-hidden="true" /></button>
              </nav>
            )}
            {search.data.meta.window_exhausted && <p className="window-note">表示上限に達しました。検索語を追加して絞り込んでください。</p>}
          </>
        )}
      </div>
      <div className="search-footer"><Attribution source={search.data?.meta.source} /></div>
    </>
  )
}
