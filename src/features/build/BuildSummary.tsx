import { useState } from 'react'
import { ClipboardList, RotateCcw } from 'lucide-react'
import { Dialog } from '../../components/Dialog'
import { useBuildStore } from './store'
import { getBuildSummary } from './totals'
import { formatYen } from '../../domain/currency'

export function BuildSummary() {
  const items = useBuildStore((state) => state.items)
  const clearBuild = useBuildStore((state) => state.clearBuild)
  const [confirming, setConfirming] = useState(false)
  const summary = getBuildSummary(items)

  return (
    <aside className="summary" aria-labelledby="summary-title">
      <h2 id="summary-title"><ClipboardList size={18} aria-hidden="true" />構成サマリー</h2>
      <div role="status" aria-atomic="true">
        <dl>
          <div className="summary-total"><dt>購入合計</dt><dd>{formatYen(summary.purchaseTotal)}</dd></div>
          <div className="summary-count"><dt>パーツ</dt><dd><strong>{summary.partCount}</strong><span>点</span></dd></div>
          <div className="summary-owned"><dt>流用品</dt><dd>{summary.ownedCount}<span>点</span></dd></div>
          <div className="summary-unpriced"><dt>価格未入力</dt><dd>{summary.unpricedCount}<span>点</span></dd></div>
        </dl>
        {summary.unpricedCount > 0 && <p className="summary-incomplete">※ 価格未入力 {summary.unpricedCount}点。購入合計は入力済み分のみで、構成全体の総額ではありません。</p>}
      </div>
      <p className="summary-note">価格はユーザー入力の単価です。<br /><span id="owned-rule">流用品は購入合計に含まれません。</span></p>
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
