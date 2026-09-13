import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'

type Props = {
  title: string
  titleId: string
  onClose: () => void
  children: ReactNode
  drawer?: boolean
  initialFocus?: RefObject<HTMLElement | null>
}

export function Dialog({ title, titleId, onClose, children, drawer = false, initialFocus }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

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
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [initialFocus])

  return (
    <dialog
      ref={ref}
      className={drawer ? 'dialog drawer' : 'dialog confirm-dialog'}
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
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
