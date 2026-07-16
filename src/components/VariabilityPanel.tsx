import { Metric, NumericInput } from "./CommonUi";
import { VariabilityBandChart } from "./Charts";
import { MAX_RATE_PERCENT } from "../config";
import { manYen, type VariabilityResult } from "../utils/calculations";

export function VariabilityPanel({
  title,
  description,
  result,
  volatilityRate,
  onVolatilityRateChange,
  finalLabel,
  suppressPanel = false
}: {
  title: string;
  description: string;
  result: VariabilityResult;
  volatilityRate: number;
  onVolatilityRateChange: (value: number) => void;
  finalLabel: string;
  suppressPanel?: boolean;
}) {
  if (suppressPanel) return null;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <label className="compact-number-field">
          年ごとの利回りのばらつき目安 %
          <NumericInput value={volatilityRate} min={0} max={MAX_RATE_PERCENT} allowDecimal onChange={onVolatilityRateChange} />
          <small>想定利回りを中心とした年率の標準偏差です。</small>
        </label>
      </div>
      <div className="notice-band">
        <strong>将来を予測するものではありません</strong>
        <span>{result.trialCount.toLocaleString("ja-JP")}回のモンテカルロ試行による参考試算です。最頻帯は、最も多く集まった金額帯の代表額です。</span>
      </div>
      <VariabilityBandChart rows={result.rows} />
      <div className="calculation-band compact">
        <Metric label={`${finalLabel} 下位10%`} value={manYen(result.lowerFinal)} helper="下振れ側の水準" />
        <Metric label={`${finalLabel} 最頻帯`} value={manYen(result.modeFinal)} helper="最も多かった金額帯" />
        <Metric label={`${finalLabel} 中央値`} value={manYen(result.medianFinal)} helper="結果を順に並べた中央" />
        <Metric label={`${finalLabel} 上位10%`} value={manYen(result.upperFinal)} helper="上振れ側の水準" />
      </div>
      <div className="table-wrap projection-detail-table">
        <table>
          <thead>
            <tr>
              <th>時点</th>
              <th>下位</th>
              <th>最頻帯</th>
              <th>中央値</th>
              <th>上位</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={`${row.label}-${row.yearIndex}`}>
                <td>{row.label}</td>
                <td>{manYen(row.lower)}</td>
                <td>{manYen(row.mode)}</td>
                <td>{manYen(row.median)}</td>
                <td>{manYen(row.upper)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
