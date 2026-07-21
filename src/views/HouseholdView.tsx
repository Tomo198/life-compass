import { useState } from "react";
import { DetailedCashflowEditor } from "../components/DetailedCashflowEditor";
import { FixedCostItemList } from "../components/FixedCostItemList";
import { EmptyState, Metric, MoneyInput, NumericInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { MAX_PLAN_YEAR } from "../config";
import {
  cashflowPeriodTargetLabels,
  cashflowPeriodTargetUnits,
  eventOwnerLabels
} from "../data/labels";
import { hasFeatureAccess, type AccessState } from "../features";
import type {
  CashflowPeriod,
  DetailedCashflowItem,
  DetailedCashflowItemDraft,
  FixedCostItem,
  Household,
  LifePlan,
  ViewKey
} from "../types";
import { getCurrentCashflowSummary, getFixedCostImpact, manYen, percent } from "../utils/calculations";

type HouseholdViewProps = {
  plan: LifePlan;
  updateHousehold: <K extends keyof Household>(key: K, value: Household[K]) => void;
  enableDetailedCashflow: () => boolean;
  useBasicCashflow: () => boolean;
  addDetailedCashflowItem: (draft: DetailedCashflowItemDraft) => boolean;
  updateDetailedCashflowItem: <K extends keyof DetailedCashflowItem>(
    id: string,
    key: K,
    value: DetailedCashflowItem[K]
  ) => void;
  removeDetailedCashflowItem: (id: string) => void;
  addCashflowPeriod: () => void;
  updateCashflowPeriod: <K extends keyof CashflowPeriod>(id: string, key: K, value: CashflowPeriod[K]) => void;
  removeCashflowPeriod: (id: string) => void;
  addFixedCostItem: () => void;
  updateFixedCostItem: <K extends keyof FixedCostItem>(id: string, key: K, value: FixedCostItem[K]) => void;
  removeFixedCostItem: (id: string) => void;
  setActiveView: (view: ViewKey) => void;
  accessState: AccessState;
};

export function HouseholdView({
  plan,
  updateHousehold,
  enableDetailedCashflow,
  useBasicCashflow,
  addDetailedCashflowItem,
  updateDetailedCashflowItem,
  removeDetailedCashflowItem,
  addCashflowPeriod,
  updateCashflowPeriod,
  removeCashflowPeriod,
  addFixedCostItem,
  updateFixedCostItem,
  removeFixedCostItem,
  setActiveView,
  accessState
}: HouseholdViewProps) {
  const cashflow = getCurrentCashflowSummary(plan);
  const fixedCostItems = plan.fixedCostItems || [];
  const fixedCostImpact = getFixedCostImpact(fixedCostItems);
  const canUseFixedCostImpact = hasFeatureAccess(accessState, "fixedCostImpact");
  const canUseDetailedCashflow = hasFeatureAccess(accessState, "detailedCashflow");
  const isDetailedCashflow = plan.cashflowMode === "detailed";
  const [cashflowModeMessage, setCashflowModeMessage] = useState("");
  const cashflowPeriods = plan.cashflowPeriods || [];
  const currentYear = new Date().getFullYear();
  const monthlySavingsTone =
    cashflow.monthlySavings < 0 ? "notice" : cashflow.savingsRate >= 20 ? "good" : cashflow.monthlySavings > 0 ? "check" : "neutral";
  const handleEnableDetailedCashflow = () => {
    const switched = enableDetailedCashflow();
    setCashflowModeMessage(
      switched
        ? "詳細収支を計算に使用します。基本収支と時期別変更は保持されています。"
        : "詳細収支へ変換できる項目数の上限を超えています。時期別変更を整理してから再度お試しください。"
    );
  };
  const handleUseBasicCashflow = () => {
    useBasicCashflow();
    setCashflowModeMessage("基本収支と時期別変更を計算に使用します。詳細収支は保持されています。");
  };

  return (
    <div className="view-stack">
      <section className="panel form-panel">
        <StepTitle step="3" title="基本収支" description="月単位の収支と年間特別支出を整理します。" />
        {canUseDetailedCashflow || isDetailedCashflow ? (
          <div className="cashflow-mode-control">
            <div>
              <strong>計算に使う収支</strong>
              <span>{isDetailedCashflow ? "世帯別の詳細収支" : "基本収支と時期別変更"}</span>
            </div>
            <div className="segmented-control" aria-label="収支の入力方式">
              <button
                type="button"
                className={!isDetailedCashflow ? "active" : ""}
                aria-pressed={!isDetailedCashflow}
                onClick={handleUseBasicCashflow}
              >
                基本方式
              </button>
              <button
                type="button"
                className={isDetailedCashflow ? "active" : ""}
                aria-pressed={isDetailedCashflow}
                onClick={handleEnableDetailedCashflow}
                disabled={!canUseDetailedCashflow}
                title={!canUseDetailedCashflow ? "世帯別の詳細方式はPro版で利用できます。" : undefined}
              >
                世帯別の詳細方式
              </button>
            </div>
            <span className="cashflow-mode-message" role="status" aria-live="polite">{cashflowModeMessage}</span>
          </div>
        ) : null}
        <fieldset className="cashflow-basic-fields" disabled={isDetailedCashflow}>
          <div className="form-grid">
            <MoneyInput label="月収" value={plan.household.monthlyIncome} onChange={(value) => updateHousehold("monthlyIncome", value)} />
            <MoneyInput label="ボーナス年額" value={plan.household.annualBonus} onChange={(value) => updateHousehold("annualBonus", value)} />
            <MoneyInput label="副業収入 月額" value={plan.household.sideIncome} onChange={(value) => updateHousehold("sideIncome", value)} />
            <MoneyInput label="固定費 月額" value={plan.household.fixedCost} onChange={(value) => updateHousehold("fixedCost", value)} />
            <MoneyInput label="変動費 月額" value={plan.household.variableCost} onChange={(value) => updateHousehold("variableCost", value)} />
            <MoneyInput
              label="年間特別支出"
              value={plan.household.annualSpecialCost}
              onChange={(value) => updateHousehold("annualSpecialCost", value)}
            />
          </div>
        </fieldset>
        {isDetailedCashflow ? (
          <div className="notice-band check cashflow-mode-note">
            <strong>基本収支は保持されています</strong>
            <span>現在の計算には、下の世帯別・期間別の詳細収支を使用しています。</span>
          </div>
        ) : null}
      </section>
      <section className="calculation-band">
        <Metric label="月間生活費" value={manYen(cashflow.monthlyLivingCost)} helper={`年間 ${manYen(cashflow.annualLivingCost)}`} />
        <Metric label="通常月の家計余剰" value={manYen(cashflow.monthlySavings)} helper={`収入 - 生活費 / ${percent(cashflow.savingsRate)}`} />
        <Metric
          label="年間収入"
          value={manYen(cashflow.annualIncome)}
          helper={`年間貯蓄見込み ${manYen(cashflow.annualSavings)} / ${percent(cashflow.annualSavingsRate)}`}
        />
      </section>
      <section className={`notice-band ${monthlySavingsTone}`}>
        <strong>
          {cashflow.monthlySavings < 0
            ? "毎月の収支がマイナスです"
            : cashflow.savingsRate >= 20
              ? "貯蓄率は高めの前提です"
              : cashflow.monthlySavings > 0
                ? "通常月は家計余剰が見込めます"
                : "収支がほぼ同じです"}
        </strong>
        <span>
          {cashflow.monthlySavings < 0
            ? "入力ミスがないか確認し、固定費、変動費、年間特別支出のどこが大きいかを見直すと次の判断がしやすくなります。"
            : "通常月の家計余剰は、目標への配分と将来資産の見通しに使います。生活防衛資金の到達目安には、現金として残す額を使います。"}
        </span>
      </section>
      <section className="helper-grid">
        <div>
          <strong>固定費</strong>
          <span>家賃、通信費、保険、サブスク、ローンなど毎月おおむね決まって出る支出です。</span>
        </div>
        <div>
          <strong>変動費</strong>
          <span>食費、日用品、交際費、交通費など月によって変わる支出です。</span>
        </div>
        <div>
          <strong>年間特別支出</strong>
          <span>旅行、家電、帰省、税金、車検など年に数回ある支出を年額で入れます。</span>
        </div>
      </section>
      {canUseDetailedCashflow ? (
        isDetailedCashflow ? (
          <section className="panel">
            <div className="section-heading">
              <div>
                <div className="title-with-badge">
                  <h2>世帯別・期間別の詳細収支</h2>
                  <span className="pro-inline-badge">Pro</span>
                </div>
                <p>本人、配偶者、子ども、親、世帯共通の収入と支出を期間ごとに整理します。</p>
              </div>
            </div>
            <DetailedCashflowEditor
              items={plan.detailedCashflowItems || []}
              members={plan.householdMembers}
              currentAge={plan.profile.age}
              onAdd={addDetailedCashflowItem}
              onUpdate={updateDetailedCashflowItem}
              onRemove={removeDetailedCashflowItem}
            />
          </section>
        ) : (
        <section className="panel">
          <div className="section-heading">
            <div>
              <div className="title-with-badge">
                <h2>時期別の収入・支出</h2>
                <span className="pro-inline-badge">Proプレビュー</span>
              </div>
              <p>育休、転職、教育費、住宅費など、期間中だけ変わる金額を設定します。対象期間は基本収支の金額から置き換えて試算します。</p>
            </div>
            <button type="button" onClick={addCashflowPeriod}>期間を追加</button>
          </div>
          {cashflowPeriods.length === 0 ? (
            <EmptyState title="時期別の変更はありません" detail="現在の基本収支が将来も続く前提で試算しています。" />
          ) : (
            <div className="cashflow-period-list">
              {cashflowPeriods.map((period) => {
                const startAge = plan.profile.age + Math.max(0, period.startYear - currentYear);
                const endAge = plan.profile.age + Math.max(0, period.endYear - currentYear);
                return (
                  <div className="cashflow-period-row" key={period.id}>
                    <div className="cashflow-period-heading">
                      <label>
                        変更名
                        <input value={period.title} onChange={(event) => updateCashflowPeriod(period.id, "title", event.target.value)} />
                      </label>
                      <button type="button" className="text-button danger-text" onClick={() => removeCashflowPeriod(period.id)}>削除</button>
                    </div>
                    <div className="form-grid cashflow-period-fields">
                      <label>
                        対象者
                        <select value={period.owner} onChange={(event) => updateCashflowPeriod(period.id, "owner", event.target.value as CashflowPeriod["owner"])}>
                          {Object.entries(eventOwnerLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                      </label>
                      <label>
                        変更する項目
                        <select value={period.target} onChange={(event) => updateCashflowPeriod(period.id, "target", event.target.value as CashflowPeriod["target"])}>
                          {Object.entries(cashflowPeriodTargetLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                      </label>
                      <label>
                        開始年
                        <NumericInput value={period.startYear} min={currentYear} max={MAX_PLAN_YEAR} onChange={(value) => updateCashflowPeriod(period.id, "startYear", value)} />
                      </label>
                      <label>
                        終了年
                        <NumericInput value={period.endYear} min={period.startYear} max={MAX_PLAN_YEAR} onChange={(value) => updateCashflowPeriod(period.id, "endYear", value)} />
                      </label>
                      <MoneyInput label={`期間中の金額（${cashflowPeriodTargetUnits[period.target]}）`} value={period.amount} onChange={(value) => updateCashflowPeriod(period.id, "amount", value)} />
                      <label>
                        メモ
                        <input value={period.memo} onChange={(event) => updateCashflowPeriod(period.id, "memo", event.target.value)} placeholder="例: 育休中、大学在学中" />
                      </label>
                    </div>
                    <p className="cashflow-period-summary">{period.startYear}年（{startAge}歳）から{period.endYear}年（{endAge}歳）まで、{cashflowPeriodTargetLabels[period.target]}を{manYen(period.amount)}として試算します。</p>
                  </div>
                );
              })}
            </div>
          )}
          <div className="notice-band check cashflow-period-note">
            <strong>同じ項目の期間が重なった場合</strong>
            <span>開始年が新しい設定を優先します。同じ開始年の場合は、一覧の下にある設定を優先します。</span>
          </div>
        </section>
        )
      ) : (
        <section className="panel pro-locked-panel">
          <div className="title-with-badge">
            <h2>時期別の収入・支出</h2>
            <span className="pro-inline-badge">Pro</span>
          </div>
          <p>育休、転職、教育費、住宅費など、期間による変化を年次見通しへ反映できます。</p>
          <button type="button" className="secondary" onClick={() => setActiveView("pricing")}>Pro機能・料金を見る</button>
        </section>
      )}
      {canUseFixedCostImpact ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <div className="title-with-badge">
                <h2>固定費見直しインパクト</h2>
                <span className="pro-inline-badge">Proプレビュー</span>
              </div>
              <p>保険、通信費、家賃、車、サブスクなどの月額差分を整理します。表示は単純差額で、契約や商品を推奨するものではありません。</p>
            </div>
            <button type="button" onClick={addFixedCostItem}>
              項目を追加
            </button>
          </div>
          <div className="summary-grid compact">
            <Metric label="月間改善額" value={manYen(fixedCostImpact.monthlyImprovement)} helper="現在額 - 見直し後" />
            <Metric label="年間改善額" value={manYen(fixedCostImpact.annualImprovement)} helper="月間改善額 × 12" />
            <Metric label="10年の単純差額" value={manYen(fixedCostImpact.tenYearSimpleImpact)} helper="利回り等は含めない" />
            <Metric label="30年の単純差額" value={manYen(fixedCostImpact.thirtyYearSimpleImpact)} helper="前提条件に基づく試算" />
          </div>
          <FixedCostItemList
            items={fixedCostItems}
            updateFixedCostItem={updateFixedCostItem}
            removeFixedCostItem={removeFixedCostItem}
          />
        </section>
      ) : (
        <section className="panel pro-locked-panel">
          <div className="title-with-badge">
            <h2>固定費見直しインパクト</h2>
            <span className="pro-inline-badge">Pro</span>
          </div>
          <p>月額差分と長期の単純差額はPro版で確認できます。</p>
          <button type="button" className="secondary" onClick={() => setActiveView("pricing")}>
            Pro機能・料金を見る
          </button>
        </section>
      )}
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "assets", label: "資産入力" }}
        next={{ view: "budget", label: "予算・実績" }}
      />
    </div>
  );
}
