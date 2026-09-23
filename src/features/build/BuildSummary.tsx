import { useState } from 'react'
import { ClipboardList, RotateCcw } from 'lucide-react'
import { Dialog } from '../../components/Dialog'
import { useBuildStore } from './store'
import { getBuildSummary } from './totals'
import { getPowerSummary } from './power'
import { PowerDetailsDialog } from './PowerDetailsDialog'
import { formatYen } from '../../domain/currency'

export function BuildSummary() {
  const items = useBuildStore((state) => state.items)
  const clearBuild = useBuildStore((state) => state.clearBuild)
  const [confirming, setConfirming] = useState(false)
  const [showPowerDetails, setShowPowerDetails] = useState(false)
  const summary = getBuildSummary(items)
  const power = getPowerSummary(items)

  return (
    <>
      <aside className="summary" aria-labelledby="summary-title">
        <h2 id="summary-title"><ClipboardList size={18} aria-hidden="true" />構成サマリー</h2>
        <div role="status" aria-atomic="true">
          <dl>
            <div className="summary-total"><dt>見積もり合計</dt><dd>{formatYen(summary.estimateTotal)}</dd></div>
            <div className="summary-count"><dt>パーツ</dt><dd><strong>{summary.partCount}</strong><span>点</span></dd></div>
            <div className="summary-unpriced"><dt>価格未入力</dt><dd>{summary.unpricedCount}<span>点</span></dd></div>
          </dl>
          {summary.unpricedCount > 0 && <p className="summary-incomplete">※ 価格未入力 {summary.unpricedCount}点。見積もり合計は入力済み分のみで、構成全体の総額ではありません。</p>}
        </div>
        <p className="summary-note">価格はユーザーが入力した金額です。</p>
        <div className="summary-power">
          <span role="status" aria-atomic="true">
            <span className="summary-power-label">推定消費電力</span>{' '}
            <span className="summary-estimated-power">{power.hasPowerParts ? `約${Math.round(power.estimatedPowerW)}W` : '―'}{power.hasMissingPowerData && <span aria-label="電力情報に欠損あり。詳細を確認してください">※</span>}</span>
            {power.recommendedPsuW !== null && <>{' '}<span className="summary-recommended-psu">（{power.recommendedPsuW}W以上推奨）</span></>}
          </span>{' '}
          <button type="button" className="button secondary power-details-button" aria-label="消費電力の詳細" aria-haspopup="dialog" onClick={() => setShowPowerDetails(true)}>詳細</button>
        </div>
        <div className="summary-footer">
          <button type="button" className="text-button reset-button" disabled={!items.length} onClick={() => setConfirming(true)}><RotateCcw size={15} aria-hidden="true" />構成をリセット</button>
        </div>
      </aside>
      {showPowerDetails && <PowerDetailsDialog power={power} onClose={() => setShowPowerDetails(false)} />}
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
    </>
  )
}
