import { AccountPanel } from "../components/AccountPanel";
import { NumericInput, StepTitle } from "../components/CommonUi";
import type { ViewKey } from "../types";
import type {
  AppReminder,
  AppSettings,
  ReviewReminderInterval,
  ThemePreference
} from "../utils/settings";

type SettingsViewProps = {
  settings: AppSettings;
  reminders: AppReminder[];
  notificationMessage: string;
  updateSettings: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  requestBrowserNotifications: () => Promise<void>;
  setActiveView: (view: ViewKey) => void;
  refreshAccessState: () => Promise<void>;
};

export function SettingsView({
  settings,
  reminders,
  notificationMessage,
  updateSettings,
  requestBrowserNotifications,
  setActiveView,
  refreshAccessState
}: SettingsViewProps) {
  return (
    <div className="view-stack">
      <AccountPanel onAccountChange={refreshAccessState} />

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
              <small>ダッシュボードに確認項目を表示します。</small>
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
          <span>通常の入力データと設定はブラウザ内に保存されます。暗号化クラウドバックアップは、データ管理で利用者が明示的に操作した場合だけ作成されます。</span>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={requestBrowserNotifications}>
            {settings.browserNotifications ? "ブラウザ通知を確認" : "ブラウザ通知を許可"}
          </button>
        </div>
        <p className="muted">ブラウザ通知はLife Compassを開いた日に補助表示します。ブラウザを閉じている間の予約通知は行いません。</p>
        {notificationMessage && <p className="inline-message">{notificationMessage}</p>}
      </section>

      <section className="panel">
        <StepTitle step="3" title="基本的な使い方" description="無料版で1つのライフプランを作る流れです。" />
        <ol className="manual-list">
          <li>ライフプランで年齢、家族構成、働き方、住居形態を入力します。</li>
          <li>資産入力で、現金、投資資産、その他資産、ローンなどの負債を整理します。</li>
          <li>家計入力で現在の収支を整理し、予算・実績で月末に大まかな支出を振り返ります。</li>
          <li>目標管理で目標額と期限を入力し、達成したい年齢と達成年齢の目安を確認します。</li>
          <li>シミュレーションで年次見通しを確認し、グラフの点をタップして詳細を見ます。</li>
          <li>年表に住宅、教育、車、転職などのイベントを追加し、予定年齢を確認します。</li>
          <li>メモに次の見直しや判断の理由を残します。</li>
          <li>データ管理からJSONをエクスポートしてバックアップします。</li>
          <li>別の端末やブラウザで使う場合は、保存済みJSONをインポートして復元します。</li>
        </ol>
      </section>

      <section className="settings-grid">
        <div className="panel">
          <h2>データとプライバシー</h2>
          <p>入力データは通常このブラウザ内に保存されます。JSONでバックアップ・復元でき、ログイン後に利用者自身が操作した場合だけ暗号化クラウドバックアップを作成できます。自動同期は行いません。</p>
          <button type="button" className="secondary" onClick={() => setActiveView("data")}>
            データ管理を開く
          </button>
        </div>
        <div className="panel">
          <h2>Pro機能・料金</h2>
          <p>複数シナリオ比較、固定費見直しインパクト、見直し履歴の拡張などを予定しています。初期版では課金処理は実装していません。</p>
          <button type="button" className="secondary" onClick={() => setActiveView("pricing")}>
            Pro機能・料金を見る
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>グラフの詳細表示</h2>
        <p>シミュレーション画面の年次見通しは、グラフ上の点をタップすると12ヶ月ごとの試算額、前回時点との差、貯蓄反映、イベント影響を確認できます。</p>
      </section>
    </div>
  );
}
