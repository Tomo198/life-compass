import { featureComparison, getEffectiveTier, type AccessState } from "../features";
import { legalConfig } from "../legalConfig";
import type { ViewKey } from "../types";

export function PricingView({
  setActiveView,
  accessState
}: {
  setActiveView: (view: ViewKey) => void;
  accessState: AccessState;
}) {
  const effectiveTier = getEffectiveTier(accessState);

  return (
    <div className="view-stack">
      <section className="pro-hero" data-testid="access-summary">
        <div>
          <p className="eyebrow">Pro機能・料金</p>
          <h2>Proの機能と料金をこのページで確認</h2>
          <p>現在は申込みと課金を受け付けていません。開発中のPro機能は、確認用のプレビューとして開くことができます。</p>
        </div>
        <span className="lock-badge">
          {accessState.mode === "preview" ? "課金なし・プレビュー" : effectiveTier === "pro" ? "Pro利用中" : "無料版"}
        </span>
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
          <strong>{legalConfig.proPriceLabel}</strong>
          <p className="muted">1か月ごとの自動更新を予定</p>
          <ul>
            <li>複数シナリオ保存と比較</li>
            <li>予算・実績の履歴と差分分析</li>
            <li>家族別イベントと詳細診断</li>
            <li>詳細取り崩し・老後生活プラン</li>
          </ul>
          <button type="button" className="secondary" onClick={() => setActiveView("scenarios")}>Pro機能を試す</button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Pro機能プレビュー</h2>
            <p>課金開始前のため、現在は以下の開発中機能を確認できます。</p>
          </div>
          <span className="status-pill recurring">Coming soon</span>
        </div>
        <div className="template-actions">
          <button type="button" className="secondary" onClick={() => setActiveView("scenarios")}>シナリオ比較</button>
          <button type="button" className="secondary" onClick={() => setActiveView("retirement")}>老後生活プラン</button>
          <button type="button" className="secondary" onClick={() => setActiveView("diagnosis")}>ライフプラン診断</button>
          <button type="button" className="secondary" onClick={() => setActiveView("reviews")}>レビュー履歴</button>
          <button type="button" className="secondary" onClick={() => setActiveView("simulation")}>詳細シミュレーション</button>
          <button type="button" className="secondary" onClick={() => setActiveView("household")}>固定費見直し</button>
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
        <h2>Pro版の予定条件</h2>
        <div className="boundary-grid">
          <div><strong>現在は課金しません</strong><p>カード番号や決済情報を入力する場所はなく、Pro版の申込みも受け付けていません。</p></div>
          <div><strong>更新と解約</strong><p>提供開始後は月単位で自動更新し、解約後も支払済み期間の終了まで利用できる設計を予定しています。</p></div>
        </div>
        <div className="legal-inline-links" aria-label="料金に関する文書">
          <button type="button" className="secondary" onClick={() => setActiveView("commercial")}>特定商取引法に基づく表記</button>
          <button type="button" className="secondary" onClick={() => setActiveView("refund")}>解約・返金方針</button>
          <button type="button" className="secondary" onClick={() => setActiveView("contact")}>お問い合わせ</button>
        </div>
      </section>
    </div>
  );
}
