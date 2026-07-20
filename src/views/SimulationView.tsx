import { useMemo, useState } from "react";
import { AnnualCashflowChart, LineChart } from "../components/Charts";
import { Metric, MoneyInput, NumericInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import {
  MAX_PLAN_AGE,
  MAX_PROJECTION_YEARS,
  MAX_RATE_PERCENT
} from "../config";
import { defaultPlan } from "../data/defaultPlan";
import { hasFeatureAccess, type AccessState } from "../features";
import type {
  LifePlan,
  SimulationSettings,
  ViewKey,
  WithdrawalPlanSettings
} from "../types";
import {
  emergencyMonthsLabel,
  getAnnualProjectionRows,
  getBasicProjectionAllocation,
  getCashflowStressYears,
  getCashflowSummary,
  getContributionProjectionRows,
  getEmergencyFundResult,
  getMonthlyProjectionRows,
  manYen,
  percent,
  projectAssets,
  simulateContribution,
  simulateContributionVariability,
  simulateWithdrawal,
  simulateWithdrawalVariability,
  yen
} from "../utils/calculations";

const emergencyAmountLabel = (lower: number, upper: number) => {
  const lowerLabel = manYen(lower);
  const upperLabel = manYen(upper);
  return lowerLabel === upperLabel ? lowerLabel : `${lowerLabel}〜${upperLabel}`;
};

const SIMPLE_WITHDRAWAL_END_AGE = 105;

export function SimulationView({
  plan,
  updateSimulation,
  updateWithdrawalPlan,
  updateWithdrawalPlanPatch,
  setActiveView,
  accessState
}: {
  plan: LifePlan;
  updateSimulation: <K extends keyof SimulationSettings>(key: K, value: SimulationSettings[K]) => void;
  updateWithdrawalPlan: <K extends keyof WithdrawalPlanSettings>(key: K, value: WithdrawalPlanSettings[K]) => void;
  updateWithdrawalPlanPatch: (patch: Partial<WithdrawalPlanSettings>) => void;
  setActiveView: (view: ViewKey) => void;
  accessState: AccessState;
}) {
  const [simulationTab, setSimulationTab] = useState<"basic" | "contribution" | "withdrawal">("basic");
  const [projectionMode, setProjectionMode] = useState<"annual" | "monthly">("annual");
  const [projectionYears, setProjectionYears] = useState<10 | 30>(30);
  const [projectionMonths, setProjectionMonths] = useState<12 | 24>(24);
  const canUseSimulationVariability = hasFeatureAccess(accessState, "simulationVariability");
  const currentLiquidAssets = plan.assets.cash + plan.assets.investment;
  const withdrawalPlan = plan.withdrawalPlan || defaultPlan.withdrawalPlan;
  const withdrawalStartAge = withdrawalPlan.startAge;
  const withdrawalStartingAssets = withdrawalPlan.startingAssets;
  const withdrawalEndAge = Math.max(SIMPLE_WITHDRAWAL_END_AGE, withdrawalStartAge);
  const withdrawalYears = Math.max(0, withdrawalEndAge - withdrawalStartAge);
  const withdrawalMode = withdrawalPlan.withdrawalMode;
  const monthlyWithdrawalAmount = withdrawalPlan.monthlyWithdrawalAmount;
  const annualWithdrawalRate = withdrawalPlan.annualWithdrawalRate;
  const withdrawalReturnRate = withdrawalPlan.annualReturnRate;
  const withdrawalInflationRate = withdrawalPlan.inflationRate;
  const [returnVariabilityRate, setReturnVariabilityRate] = useState(12);
  const updateWithdrawalStartAge = (value: number) => {
    updateWithdrawalPlanPatch({
      startAge: value,
      years: Math.max(1, Math.max(SIMPLE_WITHDRAWAL_END_AGE, value) - value)
    });
  };
  const withdrawalSettings = useMemo(
    () => ({
      startAge: withdrawalStartAge,
      currentAssets: withdrawalStartingAssets,
      monthlyLivingCost: 0,
      monthlyPension: 0,
      withdrawalMode,
      monthlyWithdrawalAmount,
      annualWithdrawalRate,
      annualReturnRate: withdrawalReturnRate,
      inflationRate: withdrawalInflationRate,
      years: withdrawalYears
    }),
    [
      annualWithdrawalRate,
      monthlyWithdrawalAmount,
      withdrawalInflationRate,
      withdrawalMode,
      withdrawalReturnRate,
      withdrawalStartAge,
      withdrawalStartingAssets,
      withdrawalYears
    ]
  );
  const projection10 = useMemo(() => projectAssets(plan, 10), [plan]);
  const projection30 = useMemo(() => projectAssets(plan, 30), [plan]);
  const annualRows = useMemo(() => getAnnualProjectionRows(plan, projectionYears), [plan, projectionYears]);
  const annualCashflowRows = annualRows.slice(1);
  const cashflowStressYears = useMemo(() => getCashflowStressYears(plan, annualRows), [annualRows, plan]);
  const monthlyRows = useMemo(() => getMonthlyProjectionRows(plan, projectionMonths), [plan, projectionMonths]);
  const basicAllocation = useMemo(() => getBasicProjectionAllocation(plan), [plan]);
  const emergency = getEmergencyFundResult(plan);
  const contribution = simulateContribution(plan.simulation);
  const contributionRows = useMemo(() => getContributionProjectionRows(plan.simulation), [plan.simulation]);
  const contributionChartPoints = contributionRows.map((row) => ({
    year: row.year,
    label: `${row.year}年目`,
    value: row.value,
    annualSavings: row.contribution,
    returnImpact: row.returnImpact
  }));
  const contributionVariability = useMemo(
    () => simulationTab === "contribution" && canUseSimulationVariability
      ? simulateContributionVariability(plan.simulation, returnVariabilityRate)
      : null,
    [canUseSimulationVariability, plan.simulation, returnVariabilityRate, simulationTab]
  );
  const withdrawalResult = useMemo(
    () => simulationTab === "withdrawal" ? simulateWithdrawal(withdrawalSettings) : null,
    [simulationTab, withdrawalSettings]
  );
  const withdrawalVariability = useMemo(
    () => simulationTab === "withdrawal" && canUseSimulationVariability
      ? simulateWithdrawalVariability(withdrawalSettings, returnVariabilityRate)
      : null,
    [canUseSimulationVariability, returnVariabilityRate, simulationTab, withdrawalSettings]
  );
  const withdrawalChartPoints = withdrawalResult
    ? [
        {
          year: 0,
          label: `${withdrawalStartAge}歳`,
          age: withdrawalStartAge,
          value: withdrawalStartingAssets
        },
        ...withdrawalResult.rows.map((row) => ({
          year: row.yearIndex,
          label: `${row.age + 1}歳`,
          age: row.age + 1,
          value: row.assets,
          eventImpact: row.withdrawalAmount,
          returnImpact: row.returnImpact,
          impactLabel: "取り崩し額",
          returnLabel: "運用の影響"
        }))
      ]
    : [];
  const withdrawalChartVariabilityRows = withdrawalVariability
    ? [
        {
          yearIndex: 0,
          label: `${withdrawalStartAge}歳`,
          lower: withdrawalStartingAssets,
          mode: withdrawalStartingAssets,
          median: withdrawalStartingAssets,
          upper: withdrawalStartingAssets
        },
        ...withdrawalVariability.rows
      ]
    : [];
  const chartRows = projectionMode === "annual" ? annualRows : monthlyRows;
  const allocationWarnings = [
    basicAllocation.monthlySurplus < 0
      ? `通常月の家計収支が${yen(Math.abs(basicAllocation.monthlySurplus))}の赤字のため、毎月の投資配分は0円として試算します。`
      : basicAllocation.monthlyInvestmentExcess > 0
        ? `毎月の投資額が家計余剰を${yen(basicAllocation.monthlyInvestmentExcess)}上回るため、試算では${yen(basicAllocation.monthlyInvestment)}を上限にしています。`
        : "",
    basicAllocation.annualBonusInvestmentExcess > 0
      ? `ボーナスから投資へ回す額がボーナス年額を${yen(basicAllocation.annualBonusInvestmentExcess)}上回るため、試算では${yen(basicAllocation.annualBonusInvestment)}を上限にしています。`
      : ""
  ].filter(Boolean);

  return (
    <div className="view-stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>シミュレーション種別</h2>
            <p>基本見通し、積立試算、取り崩し試算を切り替えて確認します。</p>
          </div>
          <div className="segmented-control" aria-label="シミュレーション種別">
            <button type="button" className={simulationTab === "basic" ? "active" : ""} onClick={() => setSimulationTab("basic")}>
              基本
            </button>
            <button
              type="button"
              className={simulationTab === "contribution" ? "active" : ""}
              onClick={() => setSimulationTab("contribution")}
            >
              積立試算
            </button>
            <button
              type="button"
              className={simulationTab === "withdrawal" ? "active" : ""}
              onClick={() => setSimulationTab("withdrawal")}
            >
              取り崩し試算
            </button>
          </div>
        </div>
      </section>

      {simulationTab === "basic" && (
      <>
      <section className="panel">
        <div className="section-heading">
          <StepTitle step="6" title="基本資産推移" description="入力条件に基づく10年/30年の見通しです。" />
          <div className="simulation-controls">
            <div className="segmented-control" aria-label="表示単位">
              <button type="button" className={projectionMode === "annual" ? "active" : ""} onClick={() => setProjectionMode("annual")}>
                年次
              </button>
              <button type="button" className={projectionMode === "monthly" ? "active" : ""} onClick={() => setProjectionMode("monthly")}>
                月次
              </button>
            </div>
            {projectionMode === "annual" ? (
              <div className="segmented-control" aria-label="表示期間">
                <button type="button" className={projectionYears === 10 ? "active" : ""} onClick={() => setProjectionYears(10)}>
                  10年
                </button>
                <button type="button" className={projectionYears === 30 ? "active" : ""} onClick={() => setProjectionYears(30)}>
                  30年
                </button>
              </div>
            ) : (
              <div className="segmented-control" aria-label="月次表示期間">
                <button type="button" className={projectionMonths === 12 ? "active" : ""} onClick={() => setProjectionMonths(12)}>
                  12ヶ月
                </button>
                <button type="button" className={projectionMonths === 24 ? "active" : ""} onClick={() => setProjectionMonths(24)}>
                  24ヶ月
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="projection-allocation">
          <div className="section-heading">
            <div>
              <h3>家計余剰の振り分け</h3>
              <p>家計入力から算出した余剰のうち、投資資産へ回す額を設定します。残りは現金として試算します。</p>
            </div>
          </div>
          <div className="form-grid">
            <MoneyInput
              label="毎月、投資へ回す額"
              value={plan.simulation.monthlyInvestmentAmount}
              onChange={(value) => updateSimulation("monthlyInvestmentAmount", value)}
            />
            <MoneyInput
              label="ボーナスから投資へ回す年額"
              value={plan.simulation.annualBonusInvestmentAmount}
              onChange={(value) => updateSimulation("annualBonusInvestmentAmount", value)}
            />
            <label>
              投資資産の想定利回り %
              <NumericInput
                value={plan.simulation.annualReturnRate}
                min={0}
                max={MAX_RATE_PERCENT}
                allowDecimal
                onChange={(value) => updateSimulation("annualReturnRate", value)}
              />
            </label>
          </div>
          <div className="calculation-band projection-allocation-summary">
            <Metric
              label="通常月の振り分け"
              value={`投資 ${yen(basicAllocation.monthlyInvestment)}`}
              helper={
                basicAllocation.monthlyCash >= 0
                  ? `現金 ${yen(basicAllocation.monthlyCash)}`
                  : `現金が毎月 ${yen(Math.abs(basicAllocation.monthlyCash))}減少`
              }
            />
            <Metric
              label="ボーナスの振り分け"
              value={`投資 ${yen(basicAllocation.annualBonusInvestment)}`}
              helper={`現金 ${yen(basicAllocation.annualBonusCash)}`}
            />
          </div>
          {allocationWarnings.length > 0 && (
            <div className="notice-band notice">
              <strong>入力額を試算可能な範囲に調整しています</strong>
              <span>{allocationWarnings.join(" ")}</span>
            </div>
          )}
        </div>
        <LineChart points={chartRows} />
        {projectionMode === "annual" && (
          <>
            <div className="section-heading chart-section-heading">
              <div>
                <h3>年次キャッシュフロー</h3>
                <p>収入と支出を年ごとに比較します。棒をタップすると、その年の内訳を確認できます。</p>
              </div>
            </div>
            <AnnualCashflowChart rows={annualCashflowRows} />
            <section className="cashflow-stress-summary" aria-label="家計の山場">
              <div className="section-heading">
                <div>
                  <h3>家計の山場</h3>
                  <p>年間収支、生活防衛資金、大きな支出イベントが重なる年を整理します。</p>
                </div>
              </div>
              {cashflowStressYears.length > 0 ? (
                <div className="cashflow-stress-list">
                  {cashflowStressYears.map((item) => (
                    <div className="cashflow-stress-item" key={item.year}>
                      <strong>{item.year}年 / {item.age}歳</strong>
                      <span>{item.reasons.join("。")}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="notice-band good">
                  <strong>大きな山場は見つかりませんでした</strong>
                  <span>現在の入力条件で、年間赤字や生活防衛資金の不足につながる年は表示期間内に見つかりませんでした。</span>
                </div>
              )}
            </section>
            <details className="projection-details">
              <summary>年次キャッシュフロー表を確認</summary>
              <div className="table-wrap projection-detail-table">
                <table>
                  <thead>
                    <tr>
                      <th>年 / 年齢</th>
                      <th>年間収入</th>
                      <th>年間支出</th>
                      <th>イベント収支</th>
                      <th>年間収支</th>
                      <th>現金</th>
                      <th>投資資産</th>
                      <th>純資産見通し</th>
                    </tr>
                  </thead>
                  <tbody>
                    {annualCashflowRows.map((row) => (
                      <tr key={`${row.year}-${row.age}`}>
                        <td>{row.year}年<small>{row.age}歳</small></td>
                        <td>{manYen(row.annualIncome + row.eventIncome)}</td>
                        <td>{manYen(row.annualLivingCost + row.eventExpense)}</td>
                        <td>{row.eventImpact ? manYen(row.eventImpact) : "-"}<small>{row.eventTitles.join(" / ")}</small></td>
                        <td className={row.netCashflow < 0 ? "negative-value" : ""}>{manYen(row.netCashflow)}</td>
                        <td>{manYen(row.cashBalance)}</td>
                        <td>{manYen(row.investmentBalance)}</td>
                        <td>{manYen(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        <div className="calculation-band compact">
          <Metric label="10年後" value={manYen(projection10[10]?.value ?? 0)} helper="前提条件に基づく試算" />
          <Metric label="30年後" value={manYen(projection30[30]?.value ?? 0)} helper="前提条件に基づく試算" />
        </div>
        <div className="notice-band check">
          <strong>基本見通しの計算前提</strong>
          <span>
            想定利回りは、現在の投資資産と上記で投資へ回す金額に適用します。余剰とボーナスの残り、ライフイベントの収支は現金へ反映し、その他資産と負債は一定として試算します。ボーナスは年1回として反映し、税金・手数料・物価上昇は含めません。年次表示は、現在から12ヶ月ごとの時点を表示します。
          </span>
        </div>
        {projectionMode === "monthly" && (
          <div className="table-wrap projection-detail-table">
            <table>
              <thead>
                <tr>
                  <th>月</th>
                  <th>試算額</th>
                  <th>貯蓄反映</th>
                  <th>イベント影響</th>
                  <th>利回り等</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{manYen(row.value)}</td>
                    <td>
                      {row.monthIndex > 0 ? yen(row.monthlySavings) : "-"}
                      {row.monthIndex > 0 ? (
                        <small>
                          投資 {yen(row.monthlyInvestmentContribution)} / 現金 {yen(row.monthlySavings - row.monthlyInvestmentContribution)}
                        </small>
                      ) : null}
                      {row.bonusSavings ? (
                        <small>
                          ボーナス: 投資 {yen(row.bonusInvestmentContribution)} / 現金 {yen(row.bonusSavings - row.bonusInvestmentContribution)}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {row.eventImpact ? manYen(row.eventImpact) : "-"}
                      {row.eventTitles.length > 0 ? <small>{row.eventTitles.join(" / ")}</small> : null}
                    </td>
                    <td>{row.returnImpact ? manYen(row.returnImpact) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <StepTitle step="確認" title="生活防衛資金チェック" description={emergency.note} />
        <div className="calculation-band compact">
          <Metric label="月間生活費" value={manYen(getCashflowSummary(plan.household).monthlyLivingCost)} helper="固定費 + 変動費 + 特別支出月割" />
          <Metric
            label="推奨生活防衛資金"
            value={emergencyAmountLabel(emergency.lowerAmount, emergency.upperAmount)}
            helper={emergencyMonthsLabel(emergency.lowerMonths, emergency.upperMonths)}
          />
          <Metric
            label="現在の現金"
            value={manYen(plan.assets.cash)}
            helper={
              emergency.status === "short"
                ? `${emergency.lowerMonths}ヶ月分まであと ${manYen(emergency.shortageToLower)}`
                : "目安を満たしています"
            }
          />
          <Metric
            label="到達目安"
            value={emergency.shortageToLower === 0 ? "達成済み" : emergency.monthsToLower ? `約${emergency.monthsToLower}ヶ月` : "未算出"}
            helper={
              emergency.shortageToLower === 0
                ? "現在の現金で目安を確保"
                : basicAllocation.monthlyCash > 0
                  ? "通常月に現金へ残す額で計算（ボーナス除く）"
                  : "通常月に現金へ残す額が0円以下"
            }
          />
        </div>
        <div className="explanation-grid">
          <div>
            <strong>計算式</strong>
            <span>月間生活費 × 目安月数で確認します。ここでは生活費を固定費、変動費、年間特別支出の月割で見ています。</span>
          </div>
          <div>
            <strong>目安月数の考え方</strong>
            <span>{emergency.note} あくまで整理用の目安で、実際に必要な金額は働き方、家族構成、住居、医療費などで変わります。</span>
          </div>
          <div>
            <strong>見直しの使い方</strong>
            <span>不足がある場合は、通常月に現金へ残す額や目標の優先度と並べて確認します。余裕がある場合も使途を決めておくと見返しやすくなります。</span>
          </div>
        </div>
      </section>
      </>
      )}

      {simulationTab === "contribution" && (
      <section className="panel form-panel">
        <StepTitle step="6" title="積立シミュレーション" description="積立額、ボーナス積立、利回り、期間をもとに年ごとの見通しを確認します。" />
        <div className="form-grid">
          <MoneyInput
            label="毎月積立額"
            value={plan.simulation.monthlyContribution}
            onChange={(value) => updateSimulation("monthlyContribution", value)}
          />
          <MoneyInput
            label="ボーナス積立 年額"
            value={plan.simulation.bonusContribution}
            onChange={(value) => updateSimulation("bonusContribution", value)}
          />
          <label>
            想定利回り %
            <NumericInput
              value={plan.simulation.annualReturnRate}
              min={0}
              max={MAX_RATE_PERCENT}
              allowDecimal
              onChange={(value) => updateSimulation("annualReturnRate", value)}
            />
          </label>
          <label>
            積立期間 年
            <NumericInput value={plan.simulation.years} min={1} max={MAX_PROJECTION_YEARS} onChange={(value) => updateSimulation("years", value)} />
          </label>
        </div>
        <div className="calculation-band compact">
          <Metric label="積立元本" value={manYen(contribution.totalContribution)} helper="毎月 + ボーナス" />
          <Metric label="試算結果" value={manYen(contribution.finalValue)} helper={`想定利回り ${plan.simulation.annualReturnRate}%`} />
          <Metric label="利回り0%との差" value={manYen(contribution.finalValue - contribution.noReturnValue)} helper="同じ積立額で比較" />
          <Metric
            label="月1万円増やした場合"
            value={manYen(contribution.increasedByTenThousand - contribution.finalValue)}
            helper="現在の前提との差"
          />
        </div>
        <div className="table-wrap narrow">
          <table>
            <thead>
              <tr>
                <th>利回り</th>
                <th>試算結果</th>
              </tr>
            </thead>
            <tbody>
              {contribution.rateComparisons.map((item) => (
                <tr key={item.rate}>
                  <td>{item.rate}%</td>
                  <td>{manYen(item.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="section-heading chart-section-heading">
          <div>
            <h2>
              積み立て資産の推移
              {contributionVariability && <span className="pro-inline-badge">{accessState.mode === "preview" ? "Proプレビュー" : "Pro"}</span>}
            </h2>
            <p>
              {contributionVariability
                ? `${contributionVariability.trialCount.toLocaleString("ja-JP")}回の試行結果を、上位10%・下位10%・中央値・最頻帯で表示します。`
                : "無料版では、想定利回りが毎年一定の前提で資産推移を表示します。"}
            </p>
          </div>
          {contributionVariability && (
            <label className="compact-number-field">
              年ごとの利回りのばらつき目安 %
              <NumericInput value={returnVariabilityRate} min={0} max={MAX_RATE_PERCENT} allowDecimal onChange={setReturnVariabilityRate} />
              <small>想定利回りを中心とした年率の標準偏差です。</small>
            </label>
          )}
        </div>
        <LineChart points={contributionChartPoints} variabilityRows={contributionVariability?.rows} />
        {contributionVariability ? (
          <div className="calculation-band compact">
            <Metric label={`${plan.simulation.years}年後 下位10%`} value={manYen(contributionVariability.lowerFinal)} helper="前提条件に基づく下振れ側の試算" />
            <Metric label={`${plan.simulation.years}年後 最頻帯`} value={manYen(contributionVariability.modeFinal)} helper="最も多かった金額帯の代表額" />
            <Metric label={`${plan.simulation.years}年後 中央値`} value={manYen(contributionVariability.medianFinal)} helper="ばらつき試算の中央値" />
            <Metric label={`${plan.simulation.years}年後 上位10%`} value={manYen(contributionVariability.upperFinal)} helper="上振れ側の試算" />
          </div>
        ) : (
          <div className="notice-band">
            <strong>利回りのばらつき試算はPro版</strong>
            <span>無料版の一定利回り試算はそのまま利用できます。Pro版では、1000回の試行による下位・中央値・上位の幅を確認できます。</span>
            <div className="button-row"><button type="button" className="secondary" onClick={() => setActiveView("pricing")}>Pro機能・料金を見る</button></div>
          </div>
        )}
        <div className="table-wrap projection-detail-table">
          <table>
            <thead>
              <tr>
                <th>年数</th>
                <th>累計積立額</th>
                <th>試算額</th>
                <th>利回り等の影響</th>
              </tr>
            </thead>
            <tbody>
              {contributionRows.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}年目</td>
                  <td>{manYen(row.contribution)}</td>
                  <td>{manYen(row.value)}</td>
                  <td>{row.returnImpact ? manYen(row.returnImpact) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {simulationTab === "withdrawal" && withdrawalResult && (
      <section className="panel form-panel">
        <StepTitle step="6" title="取り崩しシミュレーション" description="期間入力は使わず、開始年齢・開始資金・月額または年率から資産推移を確認します。" />
        <div className="form-grid">
          <label>
            取り崩し開始年齢
            <NumericInput value={withdrawalStartAge} min={plan.profile.age} max={MAX_PLAN_AGE} onChange={updateWithdrawalStartAge} />
          </label>
          <MoneyInput label="試算開始時資金" value={withdrawalStartingAssets} onChange={(value) => updateWithdrawalPlan("startingAssets", value)} />
          <label>
            取り崩し方法
            <select
              value={withdrawalMode}
              onChange={(event) => updateWithdrawalPlan("withdrawalMode", event.target.value as WithdrawalPlanSettings["withdrawalMode"])}
            >
              <option value="monthlyAmount">毎月の金額で指定</option>
              <option value="annualRate">開始時資金に対する年率で指定</option>
            </select>
          </label>
          {withdrawalMode === "monthlyAmount" ? (
            <MoneyInput
              label="毎月の取り崩し額"
              value={monthlyWithdrawalAmount}
              onChange={(value) => updateWithdrawalPlan("monthlyWithdrawalAmount", value)}
            />
          ) : (
            <label>
              取り崩し率 年率 %
              <NumericInput
                value={annualWithdrawalRate}
                min={0}
                max={100}
                allowDecimal
                onChange={(value) => updateWithdrawalPlan("annualWithdrawalRate", value)}
              />
              <small>開始時資金に対する年額を固定し、物価上昇率を反映します。</small>
            </label>
          )}
          <label>
            想定利回り %
            <NumericInput value={withdrawalReturnRate} min={0} max={MAX_RATE_PERCENT} allowDecimal onChange={(value) => updateWithdrawalPlan("annualReturnRate", value)} />
          </label>
          <label>
            インフレ率 %
            <NumericInput value={withdrawalInflationRate} min={0} max={MAX_RATE_PERCENT} allowDecimal onChange={(value) => updateWithdrawalPlan("inflationRate", value)} />
          </label>
          {withdrawalVariability && (
            <label>
              年ごとの利回りのばらつき目安 %
              <NumericInput value={returnVariabilityRate} min={0} max={MAX_RATE_PERCENT} allowDecimal onChange={setReturnVariabilityRate} />
              <small>想定利回りを中心とした年率の標準偏差です。</small>
            </label>
          )}
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={() => updateWithdrawalPlan("startingAssets", currentLiquidAssets)}>
            資産入力の現金・投資資産を試算開始時資金へ反映
          </button>
        </div>
        <div className="notice-band check">
          <strong>通常の取り崩しを単純に確認する画面です</strong>
          <span>開始年齢が105歳以下の場合は105歳まで描画し、毎月の取り崩しと利回りを月ごとに反映します。年金、社会保険、税金、老後生活費を含める場合は、別枠の老後プランを使います。</span>
        </div>
        <div className="section-heading chart-section-heading">
          <div>
            <h2>
              取り崩し後の資産推移
              {withdrawalVariability && <span className="pro-inline-badge">{accessState.mode === "preview" ? "Proプレビュー" : "Pro"}</span>}
            </h2>
            <p>
              {withdrawalVariability
                ? `${withdrawalVariability.trialCount.toLocaleString("ja-JP")}回の試行結果を、上位10%・下位10%・中央値・最頻帯で表示します。`
                : "無料版では、想定利回りが毎年一定の前提で105歳までの資産推移を表示します。"}
            </p>
          </div>
        </div>
        <LineChart points={withdrawalChartPoints} variabilityRows={withdrawalVariability ? withdrawalChartVariabilityRows : undefined} />
        <div className="calculation-band compact">
          <Metric label="試算開始時資金" value={manYen(withdrawalStartingAssets)} helper={`${withdrawalStartAge}歳から試算`} />
          <Metric label="初年度取り崩し" value={manYen(withdrawalResult.rows[0]?.withdrawalAmount ?? 0)} helper={withdrawalMode === "monthlyAmount" ? "毎月の指定額 × 12" : "開始時資金 × 取り崩し率"} />
          <Metric
            label="資産が尽きる目安"
            value={withdrawalResult.depletedAge ? `${withdrawalResult.depletedAge}歳` : `${withdrawalEndAge}歳まで残る`}
            helper="前提条件に基づく試算"
          />
          <Metric label={`${withdrawalEndAge}歳時点の試算額`} value={manYen(withdrawalResult.finalAssets)} helper="運用しながら取り崩す前提" />
        </div>
        {withdrawalVariability ? (
          <>
            <div className={`notice-band ${withdrawalVariability.depletionRate > 0 ? "notice" : "check"}`}>
              <strong>{withdrawalVariability.depletionRate > 0 ? "資金が不足するケースがあります" : "現在の前提では期間内に資金が残る見通しです"}</strong>
              <span>
                ばらつき試算では、資産が尽きるケースは {percent(withdrawalVariability.depletionRate)}
                {withdrawalVariability.medianDepletedAge ? `、中央値では ${withdrawalVariability.medianDepletedAge}歳ごろです。` : " です。"}
                取り崩し額、試算開始時資金、利回りの前提を変えて見直せます。
              </span>
            </div>
            <div className="calculation-band compact">
              <Metric label={`${withdrawalEndAge}歳時点 下位10%`} value={manYen(withdrawalVariability.lowerFinal)} helper="前提条件に基づく下振れ側の試算" />
              <Metric label={`${withdrawalEndAge}歳時点 最頻帯`} value={manYen(withdrawalVariability.modeFinal)} helper="最も多かった金額帯の代表額" />
              <Metric label={`${withdrawalEndAge}歳時点 中央値`} value={manYen(withdrawalVariability.medianFinal)} helper="ばらつき試算の中央値" />
              <Metric label={`${withdrawalEndAge}歳時点 上位10%`} value={manYen(withdrawalVariability.upperFinal)} helper="上振れ側の試算" />
            </div>
          </>
        ) : (
          <div className="notice-band">
            <strong>資産が尽きるケース割合とばらつき試算はPro版</strong>
            <span>無料版の一定利回りによる取り崩し試算はそのまま利用できます。Pro版では、1000回の試行結果と資産が尽きるケース割合を確認できます。</span>
            <div className="button-row"><button type="button" className="secondary" onClick={() => setActiveView("pricing")}>Pro機能・料金を見る</button></div>
          </div>
        )}
        <details className="projection-details">
          <summary>年次の試算表を確認</summary>
          <div className="table-wrap projection-detail-table">
            <table>
              <thead>
                <tr>
                  <th>年末年齢</th>
                  <th>年末資産</th>
                  <th>年間取り崩し額</th>
                  <th>運用の影響</th>
                </tr>
              </thead>
              <tbody>
                {withdrawalResult.rows.map((row) => (
                  <tr key={row.yearIndex}>
                    <td>{row.age + 1}歳</td>
                    <td>{manYen(row.assets)}</td>
                    <td>{manYen(row.withdrawalAmount)}</td>
                    <td>{manYen(row.returnImpact)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      )}

      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "goals", label: "目標管理" }}
        next={{ view: "timeline", label: "年表" }}
      />
    </div>
  );
}
