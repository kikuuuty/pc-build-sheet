import { useState } from 'react'
import { ClipboardList, RotateCcw } from 'lucide-react'
import { Dialog } from '../../components/Dialog'
import { useBuildStore } from './store'

export function BuildSummary() {
  const items = useBuildStore((state) => state.items)
  const clearBuild = useBuildStore((state) => state.clearBuild)
  const [confirming, setConfirming] = useState(false)
  const count = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <aside className="summary" aria-labelledby="summary-title">
      <h2 id="summary-title"><ClipboardList size={18} aria-hidden="true" />構成サマリー</h2>
      <dl>
        <div className="summary-count"><dt>選択済みパーツ</dt><dd aria-live="polite"><strong>{count}</strong><span>点</span></dd></div>
        <div className="summary-total"><dt>合計金額</dt><dd>—</dd></div>
        <div><dt>推定消費電力</dt><dd>—</dd></div>
      </dl>
      <p className="summary-note">価格の入力・電力の概算は今後対応予定です。</p>
      <div className="summary-footer">
        <p>選んだパーツは、このブラウザに自動保存されます。</p>
        <button type="button" className="text-button reset-button" disabled={!items.length} onClick={() => setConfirming(true)}><RotateCcw size={15} aria-hidden="true" />構成をリセット</button>
      </div>
      {confirming && (
        <Dialog variant="confirm" title="構成をリセットしますか？" titleId="reset-title" onClose={() => setConfirming(false)}>
          <div className="confirm-content">
            <p>選択済みのパーツをすべて削除します。</p>
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setConfirming(false)}>キャンセル</button>
              <button type="button" className="button danger" onClick={() => { clearBuild(); setConfirming(false) }}>リセットする</button>
            </div>
          </div>
        </Dialog>
      )}
    </aside>
  )
}
