import { NumericInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import type { FamilyType, Housing, LifePlan, Profile, ViewKey, WorkStyle } from "../types";

const familyLabels: Record<FamilyType, string> = {
  single: "単身",
  couple: "夫婦",
  children: "子どもあり",
  care: "親の支援/介護あり",
  other: "その他"
};

const workLabels: Record<WorkStyle, string> = {
  employee: "会社員",
  freelance: "フリーランス",
  selfEmployed: "自営業",
  variable: "収入変動が大きい",
  retired: "退職後",
  other: "その他"
};

const housingLabels: Record<Housing, string> = {
  rent: "賃貸",
  owned: "持ち家",
  mortgage: "住宅ローンあり",
  family: "家族と同居",
  other: "その他"
};

export function ProfileView({
  plan,
  updateProfile,
  setActiveView
}: {
  plan: LifePlan;
  updateProfile: <K extends keyof Profile>(key: K, value: Profile[K]) => void;
  setActiveView: (view: ViewKey) => void;
}) {
  return (
    <div className="view-stack">
      <section className="panel form-panel">
        <StepTitle step="1" title="基本プロフィール" description="生活防衛資金や年表の年齢表示に使います。" />
        <div className="form-grid">
          <label>
            プラン名
            <input value={plan.profile.name} onChange={(event) => updateProfile("name", event.target.value)} />
          </label>
          <label>
            現在の年齢
            <NumericInput value={plan.profile.age} min={0} onChange={(value) => updateProfile("age", value)} />
          </label>
          <label>
            家族構成
            <select value={plan.profile.familyType} onChange={(event) => updateProfile("familyType", event.target.value as FamilyType)}>
              {Object.entries(familyLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            働き方
            <select value={plan.profile.workStyle} onChange={(event) => updateProfile("workStyle", event.target.value as WorkStyle)}>
              {Object.entries(workLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            住居形態
            <select value={plan.profile.housing} onChange={(event) => updateProfile("housing", event.target.value as Housing)}>
              {Object.entries(housingLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section className="helper-grid">
        <div><strong>年齢</strong><span>目標の達成年齢、年表の予定年齢、将来見通しの表示に使います。</span></div>
        <div><strong>家族構成と働き方</strong><span>生活防衛資金の目安月数を決めるための前提として使います。</span></div>
        <div><strong>住居形態</strong><span>住宅ローンありの場合は、生活防衛資金をやや厚めに見ます。</span></div>
      </section>
      <StepFlowNav setActiveView={setActiveView} next={{ view: "assets", label: "資産入力" }} />
    </div>
  );
}
