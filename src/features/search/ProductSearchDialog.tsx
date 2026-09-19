import { useRef, useState, type RefObject } from 'react'
import { Plus, Search, X, ChevronLeft, ChevronRight, ArrowLeftRight } from 'lucide-react'
import { useCatalogCategories, useProductSearch } from '../../api/catalog/queries'
import type { CategoryDefinition } from '../../domain/categories'
import type { CatalogProduct } from '../../api/catalog/types'
import { productSpecSummary } from '../../domain/product-summary'
import { Dialog } from '../../components/Dialog'
import { Attribution } from '../../components/Attribution'
import { useBuildStore } from '../build/store'
import { SearchEmpty, SearchError, SearchLoading } from './SearchFeedback'
import { useDebouncedValue } from './useDebouncedValue'

export type SearchRequest = {
  category: CategoryDefinition
  target: { mode: 'add' } | { mode: 'replace'; itemId: string }
  returnFocus: RefObject<HTMLButtonElement | null>
}
type Props = SearchRequest & { onClose: () => void; onSelected: (name: string) => void }
type Pagination =
  | { mode: 'keyword'; offsets: number[] }
  | { mode: 'listing'; cursors: (string | undefined)[] }

export function ProductSearchDialog({ category, target, returnFocus, onClose, onSelected }: Props) {
  const [input, setInput] = useState('')
  const [composing, setComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const query = input.trim()
  const debounced = useDebouncedValue(query)
  const categories = useCatalogCategories()
  const waiting = composing || query !== debounced

  return (
    <Dialog variant="wide" title={`${category.label}を${target.mode === 'replace' ? '変更' : '選択'}`} titleId="search-title" onClose={onClose} initialFocus={inputRef} returnFocus={returnFocus}>
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
        : <SearchResults key={`${category.id}:${debounced}`} category={category} target={target} query={debounced} onSelected={onSelected} />}
    </Dialog>
  )
}

function SearchResults({ category, target, query, onSelected }: Pick<Props, 'category' | 'target' | 'onSelected'> & { query: string }) {
  // Remounting on query/category changes resets the history and aborts old requests.
  const [pagination, setPagination] = useState<Pagination>(() => query
    ? { mode: 'keyword', offsets: [0] }
    : { mode: 'listing', cursors: [undefined] })
  const search = useProductSearch(pagination.mode === 'keyword'
    ? { category: category.id, mode: 'keyword', query, offset: pagination.offsets.at(-1) }
    : { category: category.id, mode: 'listing', cursor: pagination.cursors.at(-1) })
  const pageCount = pagination.mode === 'keyword' ? pagination.offsets.length : pagination.cursors.length
  const hasNext = search.data !== undefined && (pagination.mode === 'keyword'
    ? search.data.meta.next_offset !== null : search.data.meta.next_cursor !== null)
  const addItem = useBuildStore((state) => state.addItem)
  const replaceItem = useBuildStore((state) => state.replaceItem)
  const [selectionError, setSelectionError] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  function select(product: CatalogProduct) {
    const saved = product.category === category.id && (target.mode === 'add' ? addItem(product) : replaceItem(target.itemId, product))
    if (saved) onSelected(product.name)
    else setSelectionError(true)
  }
  function changePage(next: Pagination) { setPagination(next); scrollRef.current?.scrollTo({ top: 0 }) }
  function previousPage() {
    if (pageCount <= 1) return
    changePage(pagination.mode === 'keyword'
      ? { mode: 'keyword', offsets: pagination.offsets.slice(0, -1) }
      : { mode: 'listing', cursors: pagination.cursors.slice(0, -1) })
  }
  function nextPage() {
    if (!search.data) return
    const { next_offset, next_cursor } = search.data.meta
    if (pagination.mode === 'keyword' && next_offset !== null) {
      changePage({ mode: 'keyword', offsets: [...pagination.offsets, next_offset] })
    } else if (pagination.mode === 'listing' && next_cursor !== null) {
      changePage({ mode: 'listing', cursors: [...pagination.cursors, next_cursor] })
    }
  }

  return (
    <>
      <div className="search-body" ref={scrollRef} aria-busy={search.isFetching}>
        {selectionError && <p className="field-error" role="alert">構成が変更されたため選択を反映できませんでした。閉じて構成を確認してください。</p>}
        {search.isPending ? <SearchLoading /> : search.isError ? <SearchError error={search.error} onRetry={() => { void search.refetch() }} /> : (
          <>
            <div className="search-result-count" role="status"><span>{query ? `「${query}」の検索結果` : `${category.label}の製品一覧`}</span><span>{search.data.meta.returned}件表示</span></div>
            {search.data.data.length === 0 ? <SearchEmpty /> : (
              <ul className="search-results">
                {search.data.data.map((product) => (
                  <li className="search-result" key={product.upstream_key}>
                    <div className="product-info"><p className="product-name">{product.name}</p><p className="product-details">{product.manufacturer ?? 'メーカー情報なし'}</p><p className="product-details">{productSpecSummary(product) || '主要スペック情報なし'}</p></div>
                    <button type="button" className="button primary add-product" aria-label={target.mode === 'add' ? `${product.name}を構成に追加` : `${product.name}に置き換える`} onClick={() => select(product)}>
                      {target.mode === 'add' ? <Plus size={15} aria-hidden="true" /> : <ArrowLeftRight size={15} aria-hidden="true" />}{target.mode === 'add' ? '追加' : '置換'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(pageCount > 1 || hasNext) && (
              <nav className="pagination" aria-label="検索結果のページ">
                <button type="button" className="button secondary" disabled={pageCount === 1 || search.isFetching} onClick={previousPage}><ChevronLeft size={15} aria-hidden="true" />前へ</button>
                <span>{pageCount}ページ</span>
                <button type="button" className="button secondary" disabled={!hasNext || search.isFetching} onClick={nextPage}>次へ<ChevronRight size={15} aria-hidden="true" /></button>
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
