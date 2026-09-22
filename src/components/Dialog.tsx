import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'

type Props = {
  title: string
  titleId: string
  onClose: () => void
  children: ReactNode
  variant: 'wide' | 'confirm' | 'edit'
  initialFocus?: RefObject<HTMLElement | null>
  returnFocus?: RefObject<HTMLElement | null>
}

export function Dialog({ title, titleId, onClose, children, variant, initialFocus, returnFocus }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    const dialog = ref.current!
    const opener = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    initialFocus?.current?.focus()
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Adding a single-category item mounts a new opener; resolve that node on close.
      const focusTarget = returnFocus?.current ?? opener
      if (focusTarget instanceof HTMLElement) focusTarget.focus()
    }
  }, [initialFocus, returnFocus])

  return (
    <dialog
      ref={ref}
      className={`dialog ${variant}-dialog`}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, summary, [tabindex]'))
          .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0)
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        // Keep Tab cycling inside the modal rather than moving into browser chrome.
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        pressedBackdrop.current = event.target === event.currentTarget
          && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
      }}
      onPointerCancel={() => { pressedBackdrop.current = false }}
      onClick={(event) => {
        // Selecting text can end outside the dialog; only a full backdrop click closes it.
        const startedOnBackdrop = pressedBackdrop.current
        pressedBackdrop.current = false
        if (!startedOnBackdrop || event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      }}
    >
      <div className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="閉じる" onClick={onClose}>
          <X size={21} aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  )
}
