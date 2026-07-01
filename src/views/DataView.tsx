import { useMemo, useRef, useState } from "react";
import { DisclaimerPanel, StepTitle } from "../components/CommonUi";
import { MAX_IMPORT_FILE_BYTES } from "../config";
import type { LifePlan } from "../types";
import {
  createRecoveryBackup,
  exportPlan,
  getRecoveryBackups,
  removeRecoveryBackup,
  validateImportedPlan,
  type RecoveryBackup,
  type RecoveryReason
} from "../utils/storage";

const recoveryReasonLabels: Record<RecoveryReason, string> = {
  "before-import": "JSON読み込み前",
  "before-reset": "初期化前",
  "load-error": "読み込みエラー時"
};

export function DataView({
  plan,
  commitPlan,
  importMessage,
  setImportMessage,
  resetPlan,
  startEmptyPlan
}: {
  plan: LifePlan;
  commitPlan: (plan: LifePlan) => boolean;
  importMessage: string;
  setImportMessage: (message: string) => void;
  resetPlan: () => void;
  startEmptyPlan: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [recoveryBackups, setRecoveryBackups] = useState<RecoveryBackup[]>(() => getRecoveryBackups());
  const updatedAt = new Date(plan.updatedAt).toLocaleString("ja-JP");
  const backupSizeKb = Math.max(1, Math.ceil(new Blob([JSON.stringify(plan)]).size / 1024));
  const versionLabel = useMemo(() => `データ形式 v${plan.version}`, [plan.version]);

  const refreshRecoveryBackups = () => setRecoveryBackups(getRecoveryBackups());

  const handleImport = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setImportMessage("JSONファイルが大きすぎます。5MB以下のLife Compassバックアップを選択してください。");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = validateImportedPlan(parsed);
        createRecoveryBackup(plan, "before-import");
        const saved = commitPlan(imported);
        refreshRecoveryBackups();
        setImportMessage(
          saved
            ? `JSONをインポートしました。${versionLabel}へ変換して保存しています。`
            : "JSONは画面へ読み込みましたが、ブラウザ内に保存できていません。先にJSONをエクスポートしてください。"
        );
      } catch (error) {
        setImportMessage(error instanceof Error ? error.message : "インポートできませんでした。");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (window.confirm("現在の入力内容を復旧用コピーへ残し、サンプルプランに戻しますか？")) {
      resetPlan();
      refreshRecoveryBackups();
    }
  };

  const handleStartEmpty = () => {
    if (window.confirm("現在の入力内容を復旧用コピーへ残し、空のプランを作成しますか？")) {
      startEmptyPlan();
      refreshRecoveryBackups();
    }
  };

  const restoreBackup = (backup: RecoveryBackup) => {
    if (!window.confirm(`${new Date(backup.createdAt).toLocaleString("ja-JP")} 時点の内容へ戻しますか？`)) return;
    try {
      createRecoveryBackup(plan, "before-reset");
      const saved = commitPlan(backup.plan);
      refreshRecoveryBackups();
      setImportMessage(
        saved
          ? "復旧用コピーから戻しました。現在の内容も復旧用コピーへ保存しています。"
          : "復旧内容は画面に反映しましたが、ブラウザ内に保存できていません。"
      );
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "復旧用コピーから戻せませんでした。");
    }
  };

  const deleteBackup = (id: string) => {
    try {
      removeRecoveryBackup(id);
      refreshRecoveryBackups();
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "復旧用コピーを削除できませんでした。");
    }
  };

  return (
    <div className="view-stack" data-testid="data-view">
      <section className="panel">
        <StepTitle step="12" title="データ管理" description="収入・支出・資産・家族情報はこのブラウザ内に保存します。" />
        <div className="data-status-grid" aria-label="保存状態">
          <div><span>保存先</span><strong>このブラウザ内</strong><small>サーバー保存やクラウド同期は行いません。</small></div>
          <div><span>最終保存</span><strong>{updatedAt}</strong><small>入力変更時に自動保存されます。</small></div>
          <div><span>バックアップ目安</span><strong>約{backupSizeKb}KB</strong><small>{versionLabel}・JSONとして保存できます。</small></div>
        </div>
        <div className="data-actions">
          <button type="button" onClick={() => exportPlan(plan)}>JSONエクスポート</button>
          <button type="button" className="secondary" onClick={() => fileInputRef.current?.click()}>JSONインポート</button>
          <button type="button" className="secondary" onClick={handleReset}>サンプルプランに戻す</button>
          <button type="button" className="danger" onClick={handleStartEmpty}>空のプランを作成</button>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            data-testid="json-import-input"
            onChange={(event) => handleImport(event.target.files?.[0])}
          />
        </div>
        {importMessage && <p className="message" role="status">{importMessage}</p>}
      </section>

      <section className="panel backup-manual">
        <h2>バックアップと復元の手順</h2>
        <div className="manual-columns">
          <div><strong>1. JSONを書き出す</strong><p>大きな入力変更、端末変更、ブラウザデータ削除の前にエクスポートします。</p></div>
          <div><strong>2. ファイルを保管する</strong><p>家計や資産情報を含むため、自分だけが確認できる場所へ保管します。</p></div>
          <div><strong>3. JSONを読み込む</strong><p>新しい端末やブラウザでインポートすると、現在の形式へ変換して復元します。</p></div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading-row">
          <div><h2>復旧用コピー</h2><p>インポートや初期化の直前状態を、このブラウザ内に最大3件保存します。</p></div>
          <span className="status-chip">{recoveryBackups.length}件</span>
        </div>
        {recoveryBackups.length === 0 ? (
          <p className="muted">まだ復旧用コピーはありません。通常のバックアップにはJSONエクスポートを利用してください。</p>
        ) : (
          <div className="recovery-list">
            {recoveryBackups.map((backup) => (
              <div className="recovery-item" key={backup.id}>
                <div>
                  <strong>{recoveryReasonLabels[backup.reason]}</strong>
                  <span>{new Date(backup.createdAt).toLocaleString("ja-JP")}・v{backup.plan.version}</span>
                </div>
                <div className="button-row">
                  <button type="button" className="secondary" onClick={() => restoreBackup(backup)}>この状態へ戻す</button>
                  <button type="button" className="text-button danger-text" onClick={() => deleteBackup(backup.id)}>削除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel notice-panel">
        <strong>JSONには個人情報が含まれます</strong>
        <p>家計、資産、目標、イベントの内容を含みます。共有、保管、削除は利用者自身で管理してください。</p>
      </section>
      <DisclaimerPanel />
    </div>
  );
}
