import { Dialog } from '../../components/Dialog'
import type { PowerBreakdown, PowerSummary } from './power'
import {
  CASE_FAN_POWER_W, COOLER_POWER_W, DEFAULT_MEMORY_POWER_W, DEFAULT_MOTHERBOARD_POWER_W,
  DIMM_POWER_W, FIXED_CATEGORY_POWER_W, MOTHERBOARD_POWER_W, PSU_CAPACITIES_W, PSU_HEADROOM, STORAGE_POWER_W,
} from './power-constants'

const breakdownRows: { key: keyof PowerBreakdown; label: string; rule: string }[] = [
  { key: 'cpu', label: 'CPU', rule: 'PPTを優先し、なければTDPを使用' },
  { key: 'gpu', label: 'GPU', rule: 'TDPを使用' },
  { key: 'motherboard', label: 'マザーボード', rule: `Mini-ITX ${MOTHERBOARD_POWER_W.miniitx}W、Micro ATX / mATX ${MOTHERBOARD_POWER_W.microatx}W、ATX ${MOTHERBOARD_POWER_W.atx}W、E-ATX ${MOTHERBOARD_POWER_W.eatx}W、その他・不明 ${DEFAULT_MOTHERBOARD_POWER_W}W` },
  { key: 'memory', label: 'メモリ', rule: `DIMM枚数 × ${DIMM_POWER_W}W。枚数不明なら1製品${DEFAULT_MEMORY_POWER_W}W` },
  { key: 'storage', label: 'ストレージ', rule: `1台あたりNVMe / PCIe SSD ${STORAGE_POWER_W.nvme}W、SATA SSD ${STORAGE_POWER_W.sataSsd}W、HDD / SSHD ${STORAGE_POWER_W.hdd}W、不明 ${STORAGE_POWER_W.unknown}W` },
  { key: 'cpuCooler', label: 'CPUクーラー', rule: `空冷・不明 ${COOLER_POWER_W.air}W、水冷 / AIO ${COOLER_POWER_W.water}W（ポンプ・付属ファン込み）` },
  { key: 'caseFans', label: 'ケースファン', rule: `セット内の個数 × ${CASE_FAN_POWER_W}W。個数不明なら1製品${CASE_FAN_POWER_W}W` },
  { key: 'expansionCards', label: '拡張カード・照明', rule: `1製品あたりネットワーク ${FIXED_CATEGORY_POWER_W.network_card}W、サウンド ${FIXED_CATEGORY_POWER_W.sound_card}W、キャプチャー ${FIXED_CATEGORY_POWER_W.capture_card}W、照明 ${FIXED_CATEGORY_POWER_W.lighting}W` },
]

export function PowerDetailsDialog({ power, onClose }: { power: PowerSummary; onClose: () => void }) {
  return (
    <Dialog variant="info" title="消費電力の計算について" titleId="power-details-title" onClose={onClose}>
      <div className="power-details" tabIndex={0} role="region" aria-label="計算方法と内訳">
        <p>選択したパーツの最大消費電力を概算した、電源容量を検討するための目安です。実測値ではありません。</p>
        <h3>現在の内訳と計算方法</h3>
        <table className="power-breakdown">
          <caption className="sr-only">カテゴリ別の消費電力</caption>
          <thead><tr><th scope="col">パーツ</th><th scope="col">概算ルール</th><th scope="col">現在</th></tr></thead>
          <tbody>{breakdownRows.map(({ key, label, rule }) => (
            <tr key={key}><th scope="row">{label}</th><td>{rule}</td><td>{Math.round(power.breakdown[key])}W</td></tr>
          ))}</tbody>
          <tfoot><tr><th scope="row" colSpan={2}>推定消費電力の合計</th><td>{power.hasPowerParts ? `約${Math.round(power.estimatedPowerW)}W` : '―'}</td></tr></tfoot>
        </table>
        <p>選択した製品の各行を1回ずつ加算します。メモリはキット内の枚数、ケースファンはセット内の個数を使用し、CPUクーラーの付属ファンはケースファンとして重複加算しません。</p>
        <p>電源自体、ケース、サーマルペースト、OS、周辺機器、ノートPC・完成品PC、アクセサリー、任意項目は対象外です。</p>
        <h3>推奨電源容量</h3>
        <p>推定消費電力の合計 × {PSU_HEADROOM}（{(PSU_HEADROOM - 1) * 100}%の余裕）を、次の容量候補のうち計算値以上になる最小の値へ切り上げます。</p>
        <p>{PSU_CAPACITIES_W.join(' / ')}W</p>
        <p>{PSU_CAPACITIES_W.at(-1)}Wを超える場合は計算値を整数Wへ切り上げます。消費電力は表示時のみ整数Wに丸め、推奨容量には丸める前の合計を使用します。</p>
        <h3>電力情報が不足している場合</h3>
        <p>CPU / GPUの有効な電力値がない場合は0Wとして集計します。CPU / GPUのどちらにも有効な電力値がない場合は推奨容量を表示しません。製品名からの推測は行いません。</p>
        {power.hasMissingPowerData && <div className="power-details-missing">
          <p>※ 一部のパーツは消費電力情報を取得できないため、実際の消費電力は表示値より高くなる可能性があります。</p>
          <ul aria-label="電力情報が不足しているパーツ">{power.missingPowerItems.map((item) => <li key={item.itemId}>{item.category.toUpperCase()}：{item.name}</li>)}</ul>
        </div>}
      </div>
    </Dialog>
  )
}
