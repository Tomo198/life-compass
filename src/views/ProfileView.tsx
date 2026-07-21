import { useState } from "react";
import { NumericInput, StepFlowNav, StepTitle } from "../components/CommonUi";
import { MAX_HOUSEHOLD_MEMBERS, MAX_PLAN_AGE, MAX_PLAN_YEAR } from "../config";
import { householdMemberRelationshipLabels } from "../data/householdMembers";
import type {
  FamilyType,
  HouseholdMember,
  HouseholdMemberDraft,
  HouseholdMemberRelationship,
  Housing,
  LifePlan,
  Profile,
  ViewKey,
  WorkStyle
} from "../types";

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

const addableRelationships: HouseholdMemberRelationship[] = ["spouse", "child", "parent", "other"];
const currentYear = new Date().getFullYear();

const createMemberDraft = (): HouseholdMemberDraft => ({
  displayName: "",
  relationship: "spouse",
  birthYear: null,
  birthMonth: null
});

const parseOptionalNumber = (value: string) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
};

const clampBirthYear = (value: number | null) =>
  value === null ? null : Math.min(MAX_PLAN_YEAR, Math.max(1900, value));

const getMemberAgeLabel = (member: HouseholdMember, profileAge: number) => {
  if (member.relationship === "self") return `現在 ${profileAge}歳`;
  if (member.birthYear === null) return "生年未設定";
  if (member.birthYear > currentYear) return `${member.birthYear}年生まれ予定`;

  const beforeBirthday = member.birthMonth !== null && new Date().getMonth() + 1 < member.birthMonth;
  return `現在 約${Math.max(0, currentYear - member.birthYear - (beforeBirthday ? 1 : 0))}歳`;
};

export function ProfileView({
  plan,
  updateProfile,
  addHouseholdMember,
  updateHouseholdMember,
  removeHouseholdMember,
  setActiveView
}: {
  plan: LifePlan;
  updateProfile: <K extends keyof Profile>(key: K, value: Profile[K]) => void;
  addHouseholdMember: (draft: HouseholdMemberDraft) => boolean;
  updateHouseholdMember: <K extends keyof HouseholdMember>(
    id: string,
    key: K,
    value: HouseholdMember[K]
  ) => void;
  removeHouseholdMember: (id: string) => boolean;
  setActiveView: (view: ViewKey) => void;
}) {
  const [memberDraft, setMemberDraft] = useState<HouseholdMemberDraft>(createMemberDraft);
  const [memberMessage, setMemberMessage] = useState("");

  const handleAddMember = () => {
    const displayName = memberDraft.displayName.trim();
    if (!displayName) {
      setMemberMessage("呼び名を入力してください。");
      return;
    }

    const added = addHouseholdMember({
      ...memberDraft,
      displayName,
      birthYear: clampBirthYear(memberDraft.birthYear)
    });
    if (!added) {
      setMemberMessage(`世帯メンバーは${MAX_HOUSEHOLD_MEMBERS}人まで登録できます。`);
      return;
    }
    setMemberDraft(createMemberDraft());
    setMemberMessage(`${displayName}を追加しました。`);
  };

  const handleRemoveMember = (member: HouseholdMember) => {
    if (!window.confirm(`${member.displayName}を世帯メンバーから削除しますか？`)) return;
    if (removeHouseholdMember(member.id)) setMemberMessage(`${member.displayName}を削除しました。`);
  };

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
            <NumericInput value={plan.profile.age} min={0} max={MAX_PLAN_AGE} onChange={(value) => updateProfile("age", value)} />
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

      <section className="panel form-panel household-members-panel">
        <div className="section-heading household-members-heading">
          <div>
            <h2>世帯メンバー</h2>
            <p>本人・配偶者・子ども・親の予定を分けて整理します。呼び名は本名でなくて構いません。</p>
          </div>
          <span>{plan.householdMembers.length}人</span>
        </div>

        <form
          className="entry-creation-form"
          data-testid="household-member-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleAddMember();
          }}
        >
          <div className="entry-creation-heading">
            <div>
              <h3>メンバーを追加</h3>
              <p>生まれた年と月は、年次見通しの年齢表示に使います。</p>
            </div>
          </div>
          <div className="entry-creation-grid household-member-create-grid">
            <label>
              呼び名
              <input
                value={memberDraft.displayName}
                placeholder="例: パートナー、子どもA"
                onChange={(event) => setMemberDraft((draft) => ({ ...draft, displayName: event.target.value }))}
              />
            </label>
            <label>
              続柄
              <select
                value={memberDraft.relationship}
                onChange={(event) => setMemberDraft((draft) => ({
                  ...draft,
                  relationship: event.target.value as HouseholdMemberRelationship
                }))}
              >
                {addableRelationships.map((relationship) => (
                  <option key={relationship} value={relationship}>{householdMemberRelationshipLabels[relationship]}</option>
                ))}
              </select>
            </label>
            <label>
              生まれた年
              <input
                type="number"
                min={1900}
                max={MAX_PLAN_YEAR}
                value={memberDraft.birthYear ?? ""}
                placeholder="例: 1992"
                onChange={(event) => setMemberDraft((draft) => ({
                  ...draft,
                  birthYear: parseOptionalNumber(event.target.value)
                }))}
              />
            </label>
            <label>
              生まれた月
              <select
                value={memberDraft.birthMonth ?? ""}
                onChange={(event) => setMemberDraft((draft) => ({
                  ...draft,
                  birthMonth: parseOptionalNumber(event.target.value)
                }))}
              >
                <option value="">未設定</option>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                  <option key={month} value={month}>{month}月</option>
                ))}
              </select>
            </label>
          </div>
          <div className="entry-form-actions">
            <span role="status" aria-live="polite">{memberMessage}</span>
            <button type="submit" disabled={plan.householdMembers.length >= MAX_HOUSEHOLD_MEMBERS}>メンバーを追加</button>
          </div>
        </form>

        <div className="registered-list-heading">
          <div>
            <h3>登録済みメンバー</h3>
            <p>本人の年齢は、上の基本プロフィールと連動します。</p>
          </div>
        </div>
        <div className="household-member-list">
          {plan.householdMembers.map((member, index) => (
            <div className="household-member-row" key={member.id}>
              <div className="household-member-row-heading">
                <strong>{member.displayName}</strong>
                <span>{getMemberAgeLabel(member, plan.profile.age)}</span>
              </div>
              <div className="household-member-fields">
                <label>
                  呼び名
                  <input
                    aria-label={`世帯メンバー${index + 1}の呼び名`}
                    value={member.displayName}
                    onChange={(event) => updateHouseholdMember(member.id, "displayName", event.target.value)}
                    onBlur={() => {
                      if (!member.displayName.trim()) {
                        updateHouseholdMember(
                          member.id,
                          "displayName",
                          householdMemberRelationshipLabels[member.relationship]
                        );
                      }
                    }}
                  />
                </label>
                {member.relationship === "self" ? (
                  <>
                    <div className="household-member-static-field">
                      <span>続柄</span>
                      <strong>本人</strong>
                    </div>
                    <div className="household-member-static-field">
                      <span>年齢</span>
                      <strong>{plan.profile.age}歳</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <label>
                      続柄
                      <select
                        aria-label={`世帯メンバー${index + 1}の続柄`}
                        value={member.relationship}
                        onChange={(event) => updateHouseholdMember(
                          member.id,
                          "relationship",
                          event.target.value as HouseholdMemberRelationship
                        )}
                      >
                        {addableRelationships.map((relationship) => (
                          <option key={relationship} value={relationship}>{householdMemberRelationshipLabels[relationship]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      生まれた年
                      <input
                        aria-label={`世帯メンバー${index + 1}の生まれた年`}
                        type="number"
                        min={1900}
                        max={MAX_PLAN_YEAR}
                        value={member.birthYear ?? ""}
                        onChange={(event) => updateHouseholdMember(
                          member.id,
                          "birthYear",
                          parseOptionalNumber(event.target.value)
                        )}
                        onBlur={() => updateHouseholdMember(member.id, "birthYear", clampBirthYear(member.birthYear))}
                      />
                    </label>
                    <label>
                      生まれた月
                      <select
                        aria-label={`世帯メンバー${index + 1}の生まれた月`}
                        value={member.birthMonth ?? ""}
                        onChange={(event) => updateHouseholdMember(
                          member.id,
                          "birthMonth",
                          parseOptionalNumber(event.target.value)
                        )}
                      >
                        <option value="">未設定</option>
                        {Array.from({ length: 12 }, (_, monthIndex) => monthIndex + 1).map((month) => (
                          <option key={month} value={month}>{month}月</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
              {member.relationship !== "self" && (
                <button type="button" className="text-button danger-text" onClick={() => handleRemoveMember(member)}>
                  削除
                </button>
              )}
            </div>
          ))}
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
