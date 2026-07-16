import { FixedCostItemList } from "../components/FixedCostItemList";
import { Metric, MoneyInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { hasFeatureAccess, type AccessState } from "../features";
import type { FixedCostItem, Household, LifePlan, ViewKey } from "../types";
import { getCashflowSummary, getFixedCostImpact, manYen, percent } from "../utils/calculations";

type HouseholdViewProps = {
  plan: LifePlan;
  updateHousehold: <K extends keyof Household>(key: K, value: Household[K]) => void;
  addFixedCostItem: () => void;
  updateFixedCostItem: <K extends keyof FixedCostItem>(id: string, key: K, value: FixedCostItem[K]) => void;
  removeFixedCostItem: (id: string) => void;
  setActiveView: (view: ViewKey) => void;
  accessState: AccessState;
};

export function HouseholdView({
  plan,
  updateHousehold,
  addFixedCostItem,
  updateFixedCostItem,
  removeFixedCostItem,
  setActiveView,
  accessState
}: HouseholdViewProps) {
  const cashflow = getCashflowSummary(plan.household);
  const fixedCostItems = plan.fixedCostItems || [];
  const fixedCostImpact = getFixedCostImpact(fixedCostItems);
  const canUseFixedCostImpact = hasFeatureAccess(accessState, "fixedCostImpact");
  const monthlySavingsTone =
    cashflow.monthlySavings < 0 ? "notice" : cashflow.savingsRate >= 20 ? "good" : cashflow.monthlySavings > 0 ? "check" : "neutral";

  return (
    <div className="view-stack">
      <section className="panel form-panel">
        <StepTitle step="3" title="基本収支" description="月単位の収支と年間特別支出を整理します。" />
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
