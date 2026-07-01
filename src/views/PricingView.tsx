import { featureComparison, proPriceLabel } from "../features";
import type { ViewKey } from "../types";

export function PricingView({ setActiveView }: { setActiveView: (view: ViewKey) => void }) {
  return (
    <div className="view-stack">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">料金</p>
          <h2>無料版を中心に、Pro版は Coming soon</h2>
          <p>現在は課金機能を実装していません。Pro画面は開発中の機能を確認するためのプレビューです。</p>
        </div>
        <span className="lock-badge">課金なし</span>
      </section>

      <section className="pricing-grid">
        <div className="pricing-card current">
          <span>現在利用可能</span>
          <h2>無料版</h2>
          <strong>0円</strong>
          <ul>
            <li>1つのライフプラン作成・保存</li>
            <li>家計、予算・実績、資産、目標、年表、メモ</li>
            <li>生活防衛資金と基本シミュレーション</li>
            <li>ブラウザ内保存とJSONバックアップ</li>
          </ul>
          <button type="button" onClick={() => setActiveView("dashboard")}>ダッシュボードへ</button>
        </div>

        <div className="pricing-card">
          <span>Coming soon</span>
          <h2>Pro版</h2>
          <strong>{proPriceLabel}</strong>
          <ul>
            <li>複数シナリオ保存と比較</li>
            <li>予算・実績の履歴と差分分析</li>
            <li>家族別イベントと詳細診断</li>
            <li>詳細取り崩し・老後生活プラン</li>
          </ul>
          <button type="button" className="secondary" onClick={() => setActiveView("pro")}>Pro予定を見る</button>
        </div>
      </section>

      <section className="panel">
        <h2>無料版とPro版の比較</h2>
        <p className="muted">既存の基本機能は無料版に残し、Pro版は比較・履歴・詳細分析を拡張します。</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>機能</th><th>無料版</th><th>Pro版予定</th></tr></thead>
            <tbody>
              {featureComparison.map((feature) => (
                <tr key={feature.key}>
                  <td>{feature.label}</td>
                  <td>{feature.free}</td>
                  <td>{feature.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>課金導入前の方針</h2>
        <div className="boundary-grid">
          <div><strong>今は決済情報を入力しません</strong><p>現在のアプリ内にカード番号や決済情報を入力する場所はありません。</p></div>
          <div><strong>正式提供時に明記すること</strong><p>価格、更新日、解約方法、返金条件、事業者情報、サポート窓口を掲載します。</p></div>
        </div>
      </section>
    </div>
  );
}
