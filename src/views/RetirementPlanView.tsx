import { useMemo, useState } from "react";
import { LineChart } from "../components/Charts";
import { Metric, MoneyInput, NumericInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { VariabilityPanel } from "../components/VariabilityPanel";
import { MAX_PLAN_AGE, MAX_RATE_PERCENT } from "../config";
import { defaultPlan } from "../data/defaultPlan";
import type { LifePlan, RetirementPlanSettings, ViewKey } from "../types";
import {
  manYen,
  percent,
  simulateRetirementPlan,
  simulateRetirementPlanVariability
} from "../utils/calculations";

export function RetirementPlanView({
  plan,
  updateRetirementPlan,
  setActiveView
}: {
  plan: LifePlan;
  updateRetirementPlan: <K extends keyof RetirementPlanSettings>(key: K, value: RetirementPlanSettings[K]) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const settings = plan.retirementPlan || defaultPlan.retirementPlan;
  const [retirementVariabilityRate, setRetirementVariabilityRate] = useState(10);
  const result = useMemo(() => simulateRetirementPlan({ ...plan, retirementPlan: settings }), [plan, settings]);
  const retirementVariability = useMemo(
    () => simulateRetirementPlanVariability({ ...plan, retirementPlan: settings }, retirementVariabilityRate),
    [plan, retirementVariabilityRate, settings]
  );
  const firstRow = result.rows[0];
  const retirementChartPoints = result.rows.map((row) => ({
    year: row.year,
    label: `${row.age}歳`,
    age: row.age,
    value: row.assets,
    eventImpact: row.withdrawalAmount,
    returnImpact: row.returnImpact,
    impactLabel: "取り崩し額",
    returnLabel: "運用の影響"
  }));
  const socialMonthlyTotal =
    settings.monthlyHealthInsurance + settings.monthlyLongTermCareInsurance + settings.monthlyTaxes;
  const pensionMonthlyTotal =
    settings.monthlyPublicPension + settings.monthlyPrivatePension + settings.monthlyOtherIncome;

  return (
    <div className="view-stack">
      <section className="pro-hero">
        <div>
          <p className="eyebrow">Pro予定 / 老後生活プラン</p>
          <h2>年金・社会保険・税金を含めた取り崩し見通し</h2>
          <p>
            退職後の生活費、国民健康保険、介護保険、税金、年金見込みを前提入力し、資産が何歳ごろまで持つかを参考情報として確認します。
          </p>
          <div className="button-row">
            <button type="button" className="secondary hero-action" onClick={() => setActiveView("simulation")}>
              基本シミュレーションを見る
            </button>
            <button type="button" className="secondary hero-action" onClick={() => setActiveView("reviews")}>
              レビュー履歴を見る
            </button>
          </div>
        </div>
        <span className="lock-badge">Coming soon</span>
      </section>

      <section className="panel">
        <div className="notice-band check">
          <strong>制度上の正確な保険料・税額計算ではありません</strong>
          <span>
            国民健康保険、介護保険、税金、年金額は自治体、年齢、所得、世帯状況などで変わります。この画面ではユーザーが置いた前提条件に基づく概算として扱います。
          </span>
        </div>
        <div className="notice-band">
          <strong>退職時点の試算資産に含める範囲</strong>
          <span>資産入力の現金・投資資産と退職金を使用します。自宅や車などのその他資産と負債は取り崩し資金に含めません。ローン返済が続く場合は、住居費などの支出へ入力してください。</span>
        </div>
        <div className="calculation-band compact">
          <Metric label="退職時点の試算資産" value={manYen(result.retirementStartAssets)} helper={`${result.startAge}歳時点の見通し`} />
          <Metric label="初年度支出" value={manYen(result.firstYearTotalCost)} helper="生活費 + 社会保険・税金" />
          <Metric label="初年度年金等" value={manYen(result.firstYearIncome)} helper="公的年金 + その他収入" />
          <Metric label="初年度取り崩し" value={manYen(result.firstYearWithdrawal)} helper="支出 - 年金等" />
          <Metric
            label="資産寿命の目安"
            value={result.depletedAge ? `${result.depletedAge}歳` : `${settings.planUntilAge}歳時点で残あり`}
            helper="前提条件に基づく試算"
          />
          <Metric label="最終年の試算額" value={manYen(result.finalAssets)} helper={`${settings.planUntilAge}歳時点`} />
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>老後資産の推移グラフ</h2>
            <p>{retirementVariability.trialCount.toLocaleString("ja-JP")}回のモンテカルロ試行で、年金・社会保険・税金を含む老後資産の幅を確認します。利回りは設定した標準偏差で毎年独立に変動する単純モデルです。</p>
          </div>
          <span className="status-pill recurring">{result.startAge}歳〜{settings.planUntilAge}歳</span>
        </div>
        <div className="chart-toolbar">
          <label className="compact-number-field">
            年ごとの利回りのばらつき目安 %
            <NumericInput value={retirementVariabilityRate} min={0} max={MAX_RATE_PERCENT} allowDecimal onChange={setRetirementVariabilityRate} />
            <small>想定利回りを中心とした年率の標準偏差です。</small>
          </label>
        </div>
        <LineChart points={retirementChartPoints} variabilityRows={retirementVariability.rows} />
        <div className="calculation-band compact">
          <Metric label={`${settings.planUntilAge}歳時点 下位10%`} value={manYen(retirementVariability.lowerFinal)} helper="前提条件に基づく下振れ側の試算" />
          <Metric label={`${settings.planUntilAge}歳時点 最頻帯`} value={manYen(retirementVariability.modeFinal)} helper="最も多かった金額帯の代表額" />
          <Metric label={`${settings.planUntilAge}歳時点 中央値`} value={manYen(retirementVariability.medianFinal)} helper="ばらつき試算の中央値" />
          <Metric label={`${settings.planUntilAge}歳時点 上位10%`} value={manYen(retirementVariability.upperFinal)} helper="上振れ側の試算" />
        </div>
        <div className={`notice-band ${retirementVariability.depletionRate > 0 ? "notice" : "check"}`}>
          <strong>資産が尽きるケース: {percent(retirementVariability.depletionRate)}</strong>
          <span>{retirementVariability.medianDepletedAge ? `資産が尽きた試行の中央値は${retirementVariability.medianDepletedAge}歳です。` : "1,000回の試行では、設定した年齢まで資産が残りました。"}</span>
        </div>
      </section>

      <section className="panel form-panel">
        <StepTitle step="Pro" title="基本条件" description="退職年齢、試算期間、利回り、物価上昇率などを置きます。" />
        <div className="form-grid">
          <label>
            退職年齢
            <NumericInput value={settings.retirementAge} min={plan.profile.age} max={MAX_PLAN_AGE} onChange={(value) => updateRetirementPlan("retirementAge", value)} />
          </label>
          <label>
            何歳まで見るか
            <NumericInput value={settings.planUntilAge} min={settings.retirementAge} max={MAX_PLAN_AGE} onChange={(value) => updateRetirementPlan("planUntilAge", value)} />
          </label>
          <MoneyInput label="退職金・一時金" value={settings.retirementLumpSum} onChange={(value) => updateRetirementPlan("retirementLumpSum", value)} />
          <label>
            退職後の想定利回り %
            <NumericInput value={settings.annualReturnRate} min={0} max={MAX_RATE_PERCENT} allowDecimal onChange={(value) => updateRetirementPlan("annualReturnRate", value)} />
          </label>
          <label>
            物価上昇率 %
            <NumericInput value={settings.inflationRate} min={0} max={MAX_RATE_PERCENT} allowDecimal onChange={(value) => updateRetirementPlan("inflationRate", value)} />
          </label>
        </div>
      </section>

      <section className="panel form-panel">
        <StepTitle step="1" title="退職後の生活費" description="毎月の生活費と、年1回程度の特別支出を分けて置きます。" />
        <div className="form-grid">
          <MoneyInput label="基本生活費 月額" value={settings.monthlyLivingCost} onChange={(value) => updateRetirementPlan("monthlyLivingCost", value)} />
          <MoneyInput label="住居費 月額" value={settings.monthlyHousingCost} onChange={(value) => updateRetirementPlan("monthlyHousingCost", value)} />
          <MoneyInput label="医療費 月額" value={settings.monthlyMedicalCost} onChange={(value) => updateRetirementPlan("monthlyMedicalCost", value)} />
          <MoneyInput label="介護・支援費 月額" value={settings.monthlyCareCost} onChange={(value) => updateRetirementPlan("monthlyCareCost", value)} />
          <MoneyInput label="年間特別支出" value={settings.annualExtraExpense} onChange={(value) => updateRetirementPlan("annualExtraExpense", value)} />
        </div>
      </section>

      <section className="panel form-panel">
        <StepTitle step="2" title="年金・収入" description="公的年金、企業年金、個人年金、退職後の収入を月額で置きます。" />
        <div className="form-grid">
          <MoneyInput label="公的年金 月額" value={settings.monthlyPublicPension} onChange={(value) => updateRetirementPlan("monthlyPublicPension", value)} />
          <MoneyInput label="企業年金・個人年金 月額" value={settings.monthlyPrivatePension} onChange={(value) => updateRetirementPlan("monthlyPrivatePension", value)} />
          <MoneyInput label="その他収入 月額" value={settings.monthlyOtherIncome} onChange={(value) => updateRetirementPlan("monthlyOtherIncome", value)} />
        </div>
        <div className="helper-grid">
          <div>
            <strong>月額収入の合計</strong>
            <span>{manYen(pensionMonthlyTotal)}。ねんきん定期便や勤務先資料などを見ながら、概算として入力します。</span>
          </div>
        </div>
      </section>

      <section className="panel form-panel">
        <StepTitle step="3" title="社会保険・税金の概算" description="国民健康保険、介護保険、税金などを月額の概算で置きます。" />
        <div className="form-grid">
          <MoneyInput
            label="国民健康保険 月額概算"
            value={settings.monthlyHealthInsurance}
            onChange={(value) => updateRetirementPlan("monthlyHealthInsurance", value)}
          />
          <MoneyInput
            label="介護保険 月額概算"
            value={settings.monthlyLongTermCareInsurance}
            onChange={(value) => updateRetirementPlan("monthlyLongTermCareInsurance", value)}
          />
          <MoneyInput label="税金 月額概算" value={settings.monthlyTaxes} onChange={(value) => updateRetirementPlan("monthlyTaxes", value)} />
        </div>
        <div className="helper-grid">
          <div>
            <strong>月額概算の合計</strong>
            <span>{manYen(socialMonthlyTotal)}。正確な金額は自治体や専門家、公式資料で確認する前提です。</span>
          </div>
          <div>
            <strong>ここで扱わないこと</strong>
            <span>自治体ごとの保険料率、控除、所得区分、世帯ごとの正式な税額計算は行いません。</span>
          </div>
        </div>
      </section>

      <VariabilityPanel
        title="老後資産のばらつき試算"
        description="退職後の利回りが毎年一定ではない前提を置き、資産残高の幅と資産が尽きるケースの割合を確認します。"
        result={retirementVariability}
        suppressPanel
        volatilityRate={retirementVariabilityRate}
        onVolatilityRateChange={setRetirementVariabilityRate}
        finalLabel={`${settings.planUntilAge}歳時点`}
      />

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>年齢別の取り崩し見通し</h2>
            <p>生活費と社会保険・税金は物価上昇率を反映し、年金等の収入は現在の入力額を固定して試算します。</p>
          </div>
          <span className="status-pill recurring">{result.rows.length}年分</span>
        </div>
        <div className="table-wrap projection-detail-table">
          <table>
            <thead>
              <tr>
                <th>年齢</th>
                <th>生活費</th>
                <th>社会保険・税</th>
                <th>年金等</th>
                <th>取り崩し</th>
                <th>年末資産</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.yearIndex}>
                  <td>{row.age}歳</td>
                  <td>{manYen(row.annualLivingCost)}</td>
                  <td>{manYen(row.annualSocialInsuranceAndTax)}</td>
                  <td>{manYen(row.annualRetirementIncome)}</td>
                  <td>{manYen(row.withdrawalAmount)}</td>
                  <td>{manYen(row.assets)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {firstRow && (
          <div className="explanation-grid">
            <div>
              <strong>初年度の見方</strong>
              <span>
                支出 {manYen(firstRow.annualLivingCost + firstRow.annualSocialInsuranceAndTax)}、年金等 {manYen(firstRow.annualRetirementIncome)}、
                取り崩し {manYen(firstRow.withdrawalAmount)} の前提です。
              </span>
            </div>
            <div>
              <strong>使い方</strong>
              <span>退職年齢、生活費、年金、国民健康保険などの概算を変えて、老後生活の余裕度を比較します。</span>
            </div>
            <div>
              <strong>注意点</strong>
              <span>将来の制度、物価、医療費、介護費、運用状況を保証するものではありません。</span>
            </div>
          </div>
        )}
      </section>

      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "simulation", label: "シミュレーション" }}
        next={{ view: "scenarios", label: "シナリオ比較" }}
      />
    </div>
  );
}
