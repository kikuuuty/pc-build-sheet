import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, LoaderCircle, RefreshCw, Store, X } from 'lucide-react'
import { useProductOffers } from '../../api/catalog/queries'
import type { ProductOffer } from '../../api/catalog/types'
import { formatYen } from '../../domain/currency'
import { MAX_PRICE } from './schemas'

export function OfferButton({ productId, name, onUsePrice }: { productId: number; name: string; onUsePrice: (price: number) => void }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()
  const query = useProductOffers(productId, open)
  const empty = query.isSuccess && query.data.offers.length === 0
  return <>
    <button ref={button} type="button" className={`icon-button offer-button${empty ? ' no-offers' : ''}`}
      aria-label={`${name}の販売店を比較`} title={empty ? '販売店情報がありません' : `${name}の販売店を比較`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)}>
      <Store size={16} aria-hidden="true" />
      {query.isFetching && <LoaderCircle className="spinner offer-spinner" size={10} aria-hidden="true" />}
    </button>
    {open && <OfferPopover id={id} name={name} anchor={button} onClose={() => setOpen(false)} query={query} onUsePrice={(price) => {
      onUsePrice(price)
      button.current?.focus({ preventScroll: true })
      setOpen(false)
    }} />}
  </>
}

function OfferPopover({ id, name, anchor, onClose, query, onUsePrice }: {
  id: string; name: string; anchor: RefObject<HTMLButtonElement | null>; onClose: () => void
  query: ReturnType<typeof useProductOffers>
  onUsePrice: (price: number) => void
}) {
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

  const offers = query.data?.offers ?? []
  return createPortal(<div ref={panel} id={id} role="dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-note`}
    tabIndex={-1} className="offer-popover" onKeyDown={(event) => {
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
    <div className="offer-heading">
      <div><h2 id={`${id}-title`}>{name}</h2><p>価格比較{query.isSuccess ? ` ${offers.length}件` : ''}</p></div>
      <button type="button" className="icon-button" aria-label="価格比較を閉じる" onClick={() => { anchor.current?.focus(); onClose() }}><X size={18} aria-hidden="true" /></button>
    </div>
    <p id={`${id}-note`} className="offer-note">ショップ名・価格の部分を選ぶと、構成の価格欄に入力します。反映後も手動編集できます。送料は加算しません。</p>
    <div className="offer-content" aria-busy={query.isFetching}>
      {query.isPending ? <p role="status">価格取得中…</p>
        : query.isError ? <div role="alert"><p>価格情報を取得できませんでした。</p><button type="button" className="button secondary" disabled={query.isFetching} onClick={() => { void query.refetch() }}>再試行</button></div>
        : offers.length === 0 ? <p>販売店情報がありません</p>
        : <OfferList offers={offers} onUsePrice={onUsePrice} />}
    </div>
    {query.isSuccess && <div className="offer-footer"><button type="button" className="text-button" disabled={query.isFetching} onClick={() => { void query.refetch() }}>
      <RefreshCw size={13} aria-hidden="true" />{query.isFetching ? '価格取得中…' : '価格情報を更新'}
    </button></div>}
  </div>, document.body)
}

function OfferList({ offers, onUsePrice }: { offers: ProductOffer[]; onUsePrice: (price: number) => void }) {
  const sorted = [...offers].sort((a, b) => a.price - b.price)
  const lowest = sorted[0]?.price
  return <ul className="offer-list" aria-label="販売店の価格一覧">
    {sorted.map((offer) => <li className="offer-row" key={`${offer.provider_item_id}:${offer.seller.id}:${offer.url}`}>
      <button type="button" className="offer-select" disabled={offer.price > MAX_PRICE}
        title={offer.price > MAX_PRICE ? `構成価格の入力上限は${formatYen(MAX_PRICE)}です` : undefined}
        aria-label={`${offer.seller.name}の${offer.price.toLocaleString('ja-JP')}円を構成価格に使用`}
        onClick={() => onUsePrice(offer.price)}>
        <span className="offer-seller">{offer.seller.name}</span>
        <span className="offer-price">{formatYen(offer.price)}</span>
        <span className="offer-shipping">{offer.shipping?.name ?? '送料情報なし'}</span>
        <span className="offer-badge-slot">{offer.price === lowest && <span className="offer-lowest">最安</span>}</span>
      </button>
      <a className="icon-button" href={offer.url} target="_blank" rel="noopener noreferrer" aria-label={`${offer.seller.name}の商品ページを新しいタブで開く`}><ExternalLink size={16} aria-hidden="true" /></a>
    </li>)}
  </ul>
}
