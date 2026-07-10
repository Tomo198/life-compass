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
          <h2>変化を比べ、見直しを続けるためのPro</h2>
          <p>複数の選択肢を比べ、毎月・四半期の振り返りと長期の見通しを一つのライフプランに残します。</p>
        </div>
        <span className="lock-badge">
          {accessState.mode === "preview" ? "課金なし・プレビュー" : effectiveTier === "pro" ? "Pro利用中" : "無料版"}
        </span>
      </section>

      <section className="pricing-grid">
        <div className="pricing-card pro-offer">
          <span>Coming soon</span>
          <h2>Pro版</h2>
          <strong>{legalConfig.proPriceLabel}</strong>
          <p className="muted">1か月ごとの自動更新を予定</p>
          <ul>
            <li>複数シナリオを保存し、将来の差を比較</li>
            <li>予算・実績と前回レビューの変化を確認</li>
            <li>本人・配偶者・子ども・親の予定を整理</li>
            <li>詳細取り崩しと老後生活の見通し</li>
          </ul>
          <button type="button" onClick={() => setActiveView("scenarios")}>開発中のPro機能を確認する</button>
          <small className="pricing-preview-note">現在は申込みではなく、課金なしのプレビューです。入力内容はこのブラウザ内に保存されます。</small>
        </div>

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
          <button type="button" className="secondary" onClick={() => setActiveView("dashboard")}>ダッシュボードへ</button>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>開発中のPro機能を確認</h2>
            <p>課金開始前に限り、以下の機能を現在の入力条件で確認できます。正式提供後はPro契約が必要になる予定です。</p>
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
        <h2>月額で使い続ける理由</h2>
        <p className="muted">一度だけ試算するためではなく、状況の変化を定期的に見直したい人向けの機能です。</p>
        <div className="pro-review-cycle">
          <div><strong>毎月</strong><p>予算と実績を比べ、貯蓄や支出の変化を確認します。</p></div>
          <div><strong>四半期</strong><p>前回レビューとの差、目標の見通し、次のTODOを残します。</p></div>
          <div><strong>状況が変わったとき</strong><p>転職、住宅、家族、退職などの選択肢をシナリオで比較します。</p></div>
        </div>
        <p className="pricing-free-assurance">定期的な比較や履歴が不要な場合は、無料版だけでもライフプランの作成・保存・見直しを続けられます。</p>
      </section>

      <section className="panel">
        <h2>無料版とPro版の比較</h2>
        <p className="muted">既存の基本機能は無料版に残し、Pro版は比較・履歴・詳細分析を拡張します。</p>
        <div className="table-wrap pricing-comparison-table">
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
        <div className="pricing-comparison-mobile" data-testid="pricing-comparison-mobile">
          {featureComparison.map((feature) => (
            <section key={feature.key} className="pricing-comparison-row">
              <h3>{feature.label}</h3>
              <dl>
                <div><dt>無料版</dt><dd>{feature.free}</dd></div>
                <div><dt>Pro版予定</dt><dd>{feature.pro}</dd></div>
              </dl>
            </section>
          ))}
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
