import { Metric, MoneyInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import type { Assets, LifePlan, ViewKey } from "../types";
import { getAssetSummary } from "../utils/calculations";

const exactYenLabel = (value: number) => {
  const rounded = Math.round(value || 0);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const oku = Math.floor(absolute / 100000000);
  const man = Math.floor((absolute % 100000000) / 10000);
  const yen = absolute % 10000;
  const parts: string[] = [];

  if (oku > 0) parts.push(`${new Intl.NumberFormat("ja-JP").format(oku)}億`);
  if (man > 0) parts.push(`${new Intl.NumberFormat("ja-JP").format(man)}万`);
  if (yen > 0 || parts.length === 0) parts.push(`${new Intl.NumberFormat("ja-JP").format(yen)}`);

  return `${sign}${parts.join("")}円`;
};

export function AssetsView({
  plan,
  updateAssets,
  setActiveView
}: {
  plan: LifePlan;
  updateAssets: <K extends keyof Assets>(key: K, value: Assets[K]) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  const assets = getAssetSummary(plan.assets);
  const cashShare = assets.grossAssets > 0 ? Math.round((plan.assets.cash / assets.grossAssets) * 100) : 0;

  return (
    <div className="view-stack">
      <section className="panel form-panel">
        <StepTitle step="2" title="資産入力" description="現金、投資資産、その他資産、負債を分けて整理します。" />
        <div className="form-grid">
          <MoneyInput label="現金" value={plan.assets.cash} onChange={(value) => updateAssets("cash", value)} />
          <MoneyInput label="投資資産" value={plan.assets.investment} onChange={(value) => updateAssets("investment", value)} />
          <MoneyInput label="その他資産" value={plan.assets.other} onChange={(value) => updateAssets("other", value)} />
          <MoneyInput label="負債" value={plan.assets.debt} onChange={(value) => updateAssets("debt", value)} />
        </div>
      </section>
      <section className="calculation-band">
        <Metric label="資産合計" value={exactYenLabel(assets.grossAssets)} helper="現金 + 投資資産 + その他資産" />
        <Metric label="負債" value={exactYenLabel(plan.assets.debt)} helper="住宅ローン、借入など" />
        <Metric label="純資産" value={exactYenLabel(assets.netAssets)} helper="資産合計 - 負債" />
      </section>
      <section className="asset-formula">
        <span>計算式</span>
        <strong>{exactYenLabel(assets.grossAssets)} - {exactYenLabel(plan.assets.debt)} = {exactYenLabel(assets.netAssets)}</strong>
      </section>
      <section className="helper-grid">
        <div><strong>現金比率</strong><span>総資産のうち現金は約{cashShare}%です。生活防衛資金チェックでは現金額を使います。</span></div>
        <div><strong>負債の扱い</strong><span>住宅ローンや借入は資産合計から差し引き、純資産として表示します。</span></div>
        <div><strong>入力の目安</strong><span>細かく分けすぎず、まずは現金、投資資産、その他資産、負債の4つで整理します。</span></div>
      </section>
      <StepFlowNav
        setActiveView={setActiveView}
        previous={{ view: "profile", label: "基本情報" }}
        next={{ view: "household", label: "家計入力" }}
      />
    </div>
  );
}
