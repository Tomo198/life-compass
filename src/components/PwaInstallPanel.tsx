import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type PwaInstallPanelProps = {
  alwaysVisible?: boolean;
  onOpenBackup: () => void;
};

const isStandaloneDisplay = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

const isIosDevice = () => /iPad|iPhone|iPod/.test(window.navigator.userAgent);

export function PwaInstallPanel({ alwaysVisible = false, onOpenBackup }: PwaInstallPanelProps) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandaloneDisplay);
  const [dismissed, setDismissed] = useState(false);
  const isIos = isIosDevice();

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setDismissed(false);
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (installed || dismissed || (!alwaysVisible && !installPrompt && !isIos)) return null;

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") {
      setInstalled(true);
    } else {
      setDismissed(true);
    }
  };

  return (
    <section className="panel pwa-install-panel" aria-labelledby="pwa-install-title">
      <div>
        <p className="eyebrow">スマホ・PCで使いやすく</p>
        <h2 id="pwa-install-title">Life Compassをアプリとして追加</h2>
        <p>
          {installPrompt
            ? "ホーム画面やアプリ一覧からすぐ開けます。ブラウザの案内は、下のボタンを押したときに表示されます。"
            : isIos
              ? "Safariの共有メニューから「ホーム画面に追加」を選ぶと、アプリのように開けます。"
              : "対応ブラウザのメニューにある「アプリをインストール」または「ホーム画面に追加」を利用できます。"}
        </p>
        <small>
          追加後は別の保存場所になる場合があります。共同世帯の自動同期を有効にするか、先にJSONバックアップを保存してください。
        </small>
      </div>
      <div className="button-row">
        {installPrompt && (
          <button type="button" onClick={handleInstall}>
            アプリとしてインストール
          </button>
        )}
        <button type="button" className="secondary" onClick={onOpenBackup}>
          バックアップを確認
        </button>
        {!alwaysVisible && (
          <button type="button" className="text-button" onClick={() => setDismissed(true)}>
            今は表示しない
          </button>
        )}
      </div>
    </section>
  );
}
