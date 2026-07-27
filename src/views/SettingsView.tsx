import { useState } from "react";
import { AccountPanel } from "../components/AccountPanel";
import { HouseholdSharingPanel } from "../components/HouseholdSharingPanel";
import { NumericInput, StepTitle } from "../components/CommonUi";
import { PwaInstallPanel } from "../components/PwaInstallPanel";
import type { HouseholdSyncController } from "../hooks/useHouseholdAutoSync";
import type { LifePlan, ViewKey } from "../types";
import type {
  AppReminder,
  AppSettings,
  ReviewReminderInterval,
  ThemePreference
} from "../utils/settings";

type SettingsSection = "account" | "appearance" | "data" | "guide";

type SettingsViewProps = {
  settings: AppSettings;
  reminders: AppReminder[];
  notificationMessage: string;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  requestBrowserNotifications: () => Promise<void>;
  setActiveView: (view: ViewKey) => void;
  refreshAccessState: () => Promise<void>;
  accountVersion: number;
  onAccountChange: () => Promise<void>;
  householdSync: HouseholdSyncController;
  plan: LifePlan;
  commitPlan: (nextPlan: LifePlan) => boolean;
};

export function SettingsView({
  settings,
  reminders,
  notificationMessage,
  updateSettings,
  requestBrowserNotifications,
  setActiveView,
  refreshAccessState,
  accountVersion,
  onAccountChange,
  householdSync,
  plan,
  commitPlan
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("account");

  return (
    <div className="view-stack">
      <section className="panel settings-index">
        <div className="section-heading">
          <div>
            <p className="eyebrow">設定</p>
            <h2>管理したい内容を選択</h2>
            <p>アカウント、表示、データ、使い方を分けて確認できます。</p>
          </div>
        </div>
        <div className="settings-section-tabs" role="navigation" aria-label="設定項目">
          {[
            { value: "account", label: "アカウント・共同世帯" },
            { value: "appearance", label: "表示・通知" },
            { value: "data", label: "バックアップ・復元" },
            { value: "guide", label: "使い方" }
          ].map((section) => (
            <button
              key={section.value}
              type="button"
              aria-pressed={activeSection === section.value}
              className={activeSection === section.value ? "active" : ""}
              onClick={() => setActiveSection(section.value as SettingsSection)}
            >
              {section.label}
            </button>
          ))}
        </div>
      </section>

      {activeSection === "account" && (
        <>
          <AccountPanel onAccountChange={onAccountChange} />
          <HouseholdSharingPanel
            plan={plan}
            commitPlan={commitPlan}
            accountVersion={accountVersion}
            refreshAccessState={refreshAccessState}
            householdSync={householdSync}
          />
          <section className="panel">
            <h2>Pro機能・料金</h2>
            <p>複数シナリオ比較、見直し履歴、詳細試算、暗号化クラウド保存などを扱います。現在は正式な課金開始前のため、契約導線を準備しています。</p>
            <button type="button" className="secondary" onClick={() => setActiveView("pricing")}>
              Pro機能・料金を見る
            </button>
          </section>
        </>
      )}

      {activeSection === "appearance" && (
        <>
          <section className="panel">
            <StepTitle step="1" title="表示スタイル" description="ライト、ダーク、端末設定に合わせる表示を選べます。" />
            <div className="setting-options" role="radiogroup" aria-label="表示スタイル">
              {[
                { value: "system", label: "システムに合わせる", helper: "端末やブラウザの設定を使います" },
                { value: "light", label: "ライト", helper: "明るい背景で表示します" },
                { value: "dark", label: "ダーク", helper: "暗い背景で表示します" }
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={settings.theme === option.value}
                  className={settings.theme === option.value ? "setting-option active" : "setting-option"}
                  onClick={() => updateSettings("theme", option.value as ThemePreference)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.helper}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <StepTitle step="2" title="リマインダー" description="月末の実績入力、レビュー、目標や近いイベントの確認忘れを減らします。" />
            <div className="reminder-settings">
              <label className="setting-switch">
                <input
                  type="checkbox"
                  checked={settings.remindersEnabled}
                  onChange={(event) => updateSettings("remindersEnabled", event.target.checked)}
                />
                <span>
                  <strong>アプリ内リマインダー</strong>
                  <small>ホームに確認項目を表示します。</small>
                </span>
              </label>
              <label>
                毎月の実績入力を知らせる日
                <NumericInput
                  value={settings.actualReminderDay}
                  min={1}
                  max={28}
                  onChange={(value) => updateSettings("actualReminderDay", value)}
                />
                <small>29日以降がない月にも対応するため、1〜28日で設定します。</small>
              </label>
              <label>
                レビューの間隔
                <select
                  value={settings.reviewReminderInterval}
                  onChange={(event) => updateSettings("reviewReminderInterval", event.target.value as ReviewReminderInterval)}
                >
                  <option value="monthly">月次</option>
                  <option value="quarterly">四半期</option>
                </select>
              </label>
            </div>
            <div className="notice-band check">
              <strong>現在の確認項目: {reminders.length}件</strong>
              <span>通常の入力データと設定はブラウザ内に保存されます。ブラウザ通知は補助機能で、予約通知は行いません。</span>
            </div>
            <div className="button-row">
              <button type="button" className="secondary" onClick={requestBrowserNotifications}>
                {settings.browserNotifications ? "ブラウザ通知を確認" : "ブラウザ通知を許可"}
              </button>
            </div>
            {notificationMessage && <p className="inline-message">{notificationMessage}</p>}
          </section>
        </>
      )}

      {activeSection === "data" && (
        <>
          <PwaInstallPanel alwaysVisible onOpenBackup={() => setActiveView("data")} />
          <section className="panel">
            <h2>バックアップ・復元</h2>
            <p>JSONの保存・復元、Proの暗号化クラウドバックアップ、復旧用コピーを1つの画面で管理します。</p>
            <div className="notice-band">
              <strong>通常の保存先</strong>
              <span>入力データは通常このブラウザ内に保存されます。共同世帯の自動同期を有効にした場合だけ、暗号化した内容を共同世帯へ送ります。</span>
            </div>
            <button type="button" onClick={() => setActiveView("data")}>
              バックアップ・復元を開く
            </button>
          </section>
        </>
      )}

      {activeSection === "guide" && (
        <>
          <section className="panel">
            <StepTitle step="1" title="基本的な使い方" description="無料版で1つのライフプランを作る流れです。" />
            <ol className="manual-list">
              <li>ライフプランで年齢、家族構成、働き方、住居形態を入力します。</li>
              <li>資産入力で、現金、投資資産、その他資産、ローンなどの負債を整理します。</li>
              <li>家計入力で現在の収支を整理し、予算・実績で月末に大まかな支出を振り返ります。</li>
              <li>目標管理で目標額と期限を入力し、達成したい年齢と達成年齢の目安を確認します。</li>
              <li>シミュレーションで年次見通しを確認し、グラフの点をタップして詳細を見ます。</li>
              <li>年表に住宅、教育、車、転職などのイベントを追加し、予定年齢を確認します。</li>
              <li>メモに次の見直しや判断の理由を残します。</li>
              <li>バックアップ・復元からJSONを保存し、別の端末やブラウザでも復元できます。</li>
            </ol>
          </section>
          <section className="panel">
            <h2>グラフの詳細表示</h2>
            <p>シミュレーション画面の年次見通しは、グラフ上の点をタップすると12ヶ月ごとの試算額、前回時点との差、貯蓄反映、イベント影響を確認できます。</p>
          </section>
        </>
      )}
    </div>
  );
}
