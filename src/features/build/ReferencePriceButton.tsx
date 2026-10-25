import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw, BadgeJapaneseYen, X } from 'lucide-react'
import { usePriceSummaries } from '../../api/pricing/queries'
import { refKey, type ProductRef } from '../../api/pricing/schemas'
import { searchPriceState, initialSearchPrice } from '../search/search-price'
import { SearchPrice } from '../search/SearchPrice'
import { formatYen } from '../../domain/currency'
import { MAX_PRICE } from './schemas'

export function ReferencePriceButton({ product, name, onUsePrice }: { product: ProductRef | null; name: string; onUsePrice: (price: number, ref: ProductRef) => void }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  return <>
    <button ref={button} type="button" className="icon-button reference-price-button"
      aria-label={`${name}の参考価格を確認`} title={`${name}の参考価格を確認・適用`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)}>
      <BadgeJapaneseYen size={16} aria-hidden="true" />
    </button>
    {open && <ReferencePricePanel id={id} name={name} product={product} anchor={button} onClose={() => setOpen(false)} onUsePrice={(price) => {
      if (product) onUsePrice(price, product)
      button.current?.focus({ preventScroll: true })
      setOpen(false)
    }} />}
  </>
}

function ReferencePricePanel({ id, name, product, anchor, onClose, onUsePrice }: {
  id: string; name: string; anchor: RefObject<HTMLButtonElement | null>; onClose: () => void
  product: ProductRef | null
  onUsePrice: (price: number) => void
}) {
  const query = usePriceSummaries(product ? [product] : [])
  const summary = query.data?.find((s) => product && refKey(s) === refKey(product))
  const state = !product && query.availability === 'enabled'
    ? { status: 'missing' as const } : searchPriceState(summary, query)
  const price = initialSearchPrice(state)
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = panel.current!
    function position() {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) return
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth
      const height = viewport?.height ?? window.innerHeight
      const belowSpace = Math.max(0, top + height - 12 - rect.bottom - 8)
      const aboveSpace = Math.max(0, rect.top - 8 - top - 12)
      const below = belowSpace >= Math.min(480, aboveSpace)
      // Constrain to the chosen side so a tall list does not cover its own trigger.
      element.style.maxHeight = `${Math.min(480, height - 24, below ? belowSpace : aboveSpace)}px`
      element.style.width = `${Math.min(560, width - 24)}px`
      const box = element.getBoundingClientRect()
      element.style.left = `${Math.max(left + 12, Math.min(rect.right - box.width, left + width - box.width - 12))}px`
      const preferred = below ? rect.bottom + 8 : rect.top - box.height - 8
      element.style.top = `${Math.max(top + 12, Math.min(preferred, top + height - box.height - 12))}px`
    }
    position()
    element.focus({ preventScroll: true })
    const observer = new ResizeObserver(position)
    observer.observe(element)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [anchor])

  useEffect(() => {
    const contains = (target: EventTarget | null) => target instanceof Node
      && (panel.current?.contains(target) || anchor.current?.contains(target))
    function outside(event: PointerEvent) {
      if (contains(event.target)) return
      // Restore only when focus is still in the panel; the click may then focus its own target.
      if (panel.current?.contains(document.activeElement)) anchor.current?.focus({ preventScroll: true })
      onClose()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      anchor.current?.focus({ preventScroll: true })
      onClose()
    }
    function focusOut(event: FocusEvent) {
      if (!contains(event.target)) onClose()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    document.addEventListener('focusin', focusOut)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
      document.removeEventListener('focusin', focusOut)
    }
  }, [anchor, onClose])

  return createPortal(<div ref={panel} id={id} role="dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`}
    tabIndex={-1} className="reference-price-panel" onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
      if (event.shiftKey && (event.target === event.currentTarget || event.target === controls[0])) {
        event.preventDefault()
        anchor.current?.focus()
        onClose()
      } else if (!event.shiftKey && event.target === controls.at(-1)) {
        event.preventDefault()
        // The portal is at the end of body; resume the row's natural keyboard order.
        const next = anchor.current?.nextElementSibling
        if (next instanceof HTMLElement) next.focus()
        else anchor.current?.focus()
        onClose()
      }
    }}>
    <div className="reference-price-heading">
      <div><h2 id={`${id}-title`}>{name}</h2><p>参考価格の確認・適用</p></div>
      <button type="button" className="icon-button" aria-label="参考価格を閉じる" onClick={() => { anchor.current?.focus(); onClose() }}><X size={18} aria-hidden="true" /></button>
    </div>
    <p id={`${id}-note`} className="reference-price-note">取得先：Yahoo!ショッピング（Pricing Gateway経由）。送料・ポイントは反映しません。店舗別比較・購入リンクは現在提供していません。適用するまで構成価格は変わりません。</p>
    <div className="reference-price-content" aria-busy={query.isFetching}>
      <p role="status"><SearchPrice state={state} /></p>
      {!product && <p>保存された製品参照を確認できません。必要に応じて製品を選び直してください。</p>}
      {summary?.fetchedAt && <p>取得日時：<time dateTime={summary.fetchedAt}>{new Date(summary.fetchedAt).toLocaleString('ja-JP')}</time></p>}
      {summary && <p>状態：{summary.status}{state.status === 'ready' ? state.stale ? ' / 古い結果・再確認待ち' : ' / 取得期限内' : ''}</p>}
      {query.isError && summary && <p role="alert">再確認に失敗しました。表示は前回の結果です。</p>}
      {query.stopped && <p>自動確認は停止しました。更新完了時刻は保証されません。手動で再確認できます。</p>}
      {query.waiting && <p>次の確認可能時刻：{new Date(query.waitUntil).toLocaleTimeString('ja-JP')}</p>}
      {summary?.status === 'complete' && summary.price! > MAX_PRICE && <p>構成価格の入力上限は{formatYen(MAX_PRICE)}です。この価格は適用できません。</p>}
      {summary?.status === 'complete' && <button type="button" className="button primary" disabled={price === null}
        onClick={() => { if (price !== null) onUsePrice(price) }}>この価格を適用</button>}
    </div>
    <div className="reference-price-footer"><button type="button" className="text-button" disabled={!product || !query.canRecheck} onClick={query.recheck}>
      <RefreshCw size={13} aria-hidden="true" />{query.isFetching ? '価格を確認中' : '参考価格を再確認'}
    </button></div>
  </div>, document.body)
}
