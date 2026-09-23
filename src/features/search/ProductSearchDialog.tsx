import { useRef, useState, type RefObject } from 'react'
import { Plus, Search, X, ChevronLeft, ChevronRight, ArrowLeftRight } from 'lucide-react'
import { useCatalogCategories, useCategoryFilters, useDynamicFacets, useProductSearch, useOffersSummary } from '../../api/catalog/queries'
import type { CategoryDefinition } from '../../domain/categories'
import type { CatalogProduct } from '../../api/catalog/types'
import { productSpecSummary } from '../../domain/product-summary'
import { Dialog } from '../../components/Dialog'
import { Attribution } from '../../components/Attribution'
import { useBuildStore } from '../build/store'
import { CatalogRetryStatus, DynamicFacetError, SearchEmpty, SearchError, SearchLoading } from './SearchFeedback'
import { mergeDynamicFacetOptions } from './dynamic-facets'
import { useDebouncedValue } from './useDebouncedValue'
import { hasSearchConditions, type SearchConditions } from '../../api/catalog/filters'
import { getUiFilters } from './filter-config'
import { compileConditions, conditionTags, emptyDraft, useSearchSession } from './filter-state'
import { FilterPanel } from './FilterPanel'
import { FilterTags } from './FilterTags'
import { SearchPrice } from './SearchPrice'
import { searchPriceState, initialSearchPrice } from './search-price'

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
  const draft = useSearchSession((state) => state.drafts[category.id] ?? emptyDraft)
  const update = useSearchSession((state) => state.update)
  const setDraft = (next: typeof draft) => update(category.id, next)
  const input = draft.keyword
  const setInput = (keyword: string) => setDraft({ ...draft, keyword })
  const [composing, setComposing] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const query = input.trim()
  // Keyword/IME changes have their own timer and never invalidate facet data.
  const keywordSignature = JSON.stringify({ query, composing })
  const debouncedKeyword = useDebouncedValue(keywordSignature)
  const categories = useCatalogCategories()
  const available = categories.data?.categories.includes(category.id) ?? false
  const metadata = useCategoryFilters(category.id, available)
  const definitions = getUiFilters(category.id, metadata.data)
  const { conditions, errors } = compileConditions(category.id, definitions, draft)
  const hasFilters = category.id !== 'os'
  const tagCount = conditionTags(definitions, draft).length
  const invalid = Object.keys(errors).length > 0
  // One committed filter snapshot drives BOTH facets and search. Include raw edits so even
  // incomplete range input restarts the timer; metadata changes also revalidate the snapshot.
  const filterSignature = JSON.stringify({ selections: draft.selections, ranges: draft.ranges, conditions })
  const debouncedFilters = useDebouncedValue(filterSignature)
  const facetWaiting = filterSignature !== debouncedFilters
  const committedConditions = (JSON.parse(debouncedFilters) as { conditions: SearchConditions }).conditions
  const waiting = composing || keywordSignature !== debouncedKeyword || facetWaiting
  const facetsEnabled = available && !!metadata.data && !invalid && !facetWaiting && hasSearchConditions(committedConditions)
  const dynamic = useDynamicFacets(category.id, facetsEnabled ? committedConditions : undefined, facetsEnabled)
  const updatingFacets = !invalid && hasSearchConditions(conditions) && (facetWaiting || dynamic.isFetching)
  const displayDefinitions = mergeDynamicFacetOptions(definitions,
    facetsEnabled && !dynamic.isError ? dynamic.data : undefined, draft.selections)

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
        <FilterTags definitions={definitions} draft={draft} onChange={setDraft} />
        {hasFilters && <button type="button" className="button secondary mobile-filter-toggle" aria-expanded={filtersOpen} aria-controls="search-filters" onClick={() => setFiltersOpen(!filtersOpen)}>絞り込み{tagCount > 0 ? `（${tagCount}件）` : ''}</button>}
      </div>
      <div className="search-workspace">
        {hasFilters && <aside id="search-filters" className={`search-filters${filtersOpen ? ' is-open' : ''}`} aria-label="検索フィルター"
          onCompositionStart={(event) => { if (event.target instanceof HTMLInputElement && event.target.type !== 'search') setComposing(true) }}
          onCompositionEnd={(event) => { if (event.target instanceof HTMLInputElement && event.target.type !== 'search') setComposing(false) }}>
          <h3>絞り込み</h3>
          {metadata.retryProgress && <CatalogRetryStatus progress={metadata.retryProgress} subject="フィルター取得" compact paused={metadata.isPaused} />}
          {metadata.isError ? <SearchError error={metadata.error} onRetry={() => { void metadata.refetch() }} title="フィルターを取得できませんでした" />
            : metadata.isPending ? !metadata.retryProgress && <p className="filter-help">フィルターを読み込んでいます…</p>
            : <>
              {facetsEnabled && dynamic.retryProgress ? <CatalogRetryStatus progress={dynamic.retryProgress} subject="絞り込み候補の更新" compact paused={dynamic.isPaused} />
                : updatingFacets && <p className="filter-help">候補を更新しています…</p>}
              {facetsEnabled && dynamic.isError && <DynamicFacetError error={dynamic.error} onRetry={() => { void dynamic.refetch() }} />}
              <FilterPanel category={category.id} definitions={displayDefinitions} draft={draft} errors={errors} onChange={setDraft} />
            </>}
        </aside>}
        <div className="search-results-pane">
          {categories.retryProgress && <CatalogRetryStatus progress={categories.retryProgress} subject="カテゴリ取得" paused={categories.isPaused} />}
          {categories.isPending ? !categories.retryProgress && <div className="search-body"><SearchLoading label="カテゴリを読み込んでいます…" /></div>
            : categories.isError ? <div className="search-body"><SearchError error={categories.error} onRetry={() => { void categories.refetch() }} /></div>
            : !categories.data.categories.includes(category.id) ? <div className="search-body"><p className="search-state">このカテゴリは現在カタログで利用できません。</p></div>
            : waiting ? <div className="search-body"><SearchLoading waiting /></div>
            : tagCount > 0 && !metadata.data ? <div className="search-body"><p className="search-state">フィルターの取得後に検索します。条件を解除するとキーワードのみで検索できます。</p></div>
            : invalid ? <div className="search-body"><p className="search-state" role="alert">検索条件を確認してください。{Object.values(errors).join(' ')}</p></div>
            : <SearchResults key={`${category.id}:${debouncedKeyword}:${debouncedFilters}`} category={category} target={target} query={query} conditions={committedConditions} onSelected={onSelected} />}
        </div>
      </div>
    </Dialog>
  )
}

function SearchResults({ category, target, query, conditions, onSelected }: Pick<Props, 'category' | 'target' | 'onSelected'> & { query: string; conditions: SearchConditions }) {
  // Remounting on keyword/filter/category changes resets history and aborts old requests.
  const [pagination, setPagination] = useState<Pagination>(() => query
    ? { mode: 'keyword', offsets: [0] }
    : { mode: 'listing', cursors: [undefined] })
  const search = useProductSearch(pagination.mode === 'keyword'
    ? { category: category.id, mode: 'keyword', query, conditions, offset: pagination.offsets.at(-1) }
    : { category: category.id, mode: 'listing', conditions, cursor: pagination.cursors.at(-1) })
  const pageCount = pagination.mode === 'keyword' ? pagination.offsets.length : pagination.cursors.length
  const hasNext = search.data !== undefined && (pagination.mode === 'keyword'
    ? search.data.meta.next_offset !== null : search.data.meta.next_cursor !== null)
  const addItem = useBuildStore((state) => state.addItem)
  const replaceItem = useBuildStore((state) => state.replaceItem)
  const [selectionError, setSelectionError] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prices = useOffersSummary(search.data?.data.map(({ id }) => id) ?? [])
  const priceById = new Map(prices.data?.products.map((summary) => [summary.id, summary]))
  const priceState = (id: number) => searchPriceState(priceById.get(id), prices)
  function select(product: CatalogProduct) {
    const options = { initialPrice: initialSearchPrice(priceState(product.id)) }
    const saved = product.category === category.id && (target.mode === 'add' ? addItem(product, options) : replaceItem(target.itemId, product, options))
    if (saved) onSelected(product.name)
    else setSelectionError(true)
  }
  function changePage(next: Pagination) {
    setPagination(next)
    scrollRef.current?.scrollTo({ top: 0 })
    scrollRef.current?.closest('.search-workspace')?.scrollTo({ top: 0 })
  }
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
      <div className="search-body" ref={scrollRef} aria-busy={search.isFetching && search.retryProgress?.phase !== 'waiting'}>
        {selectionError && <p className="field-error" role="alert">構成が変更されたため選択を反映できませんでした。閉じて構成を確認してください。</p>}
        {search.retryProgress && <CatalogRetryStatus progress={search.retryProgress} subject="製品検索" paused={search.isPaused} />}
        {search.isPending ? !search.retryProgress && <SearchLoading /> : search.isError ? <SearchError error={search.error} onRetry={() => { void search.refetch() }} /> : (
          <>
            <div className="search-result-count" role="status"><span>{query ? `「${query}」の検索結果` : `${category.label}の製品一覧`}</span><span>{search.data.meta.returned}件表示</span></div>
            {search.data.data.length === 0 ? <SearchEmpty /> : (
              <ul className="search-results">
                {search.data.data.map((product) => (
                  <li className="search-result" key={product.upstream_key}>
                    <div className="product-info"><p className="product-name">{product.name}</p><p className="product-details">{product.manufacturer ?? 'メーカー情報なし'}</p><p className="product-details">{productSpecSummary(product) || '主要スペック情報なし'}</p></div>
                    <SearchPrice state={priceState(product.id)} />
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
            {search.data.meta.window_exhausted && <p className="window-note">表示上限に達しました。検索語やフィルターで絞り込んでください。</p>}
          </>
        )}
      </div>
      <div className="search-footer"><Attribution source={search.data?.meta.source} /></div>
    </>
  )
}
