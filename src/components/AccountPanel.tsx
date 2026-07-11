import { useEffect, useRef, useState } from "react";

type AccountUser = {
  id: string;
  email: string | null;
  emailVerified: boolean;
};

type GoogleCredentialResponse = {
  credential: string;
};

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        nonce: string;
        auto_select: boolean;
      }) => void;
      renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
      disableAutoSelect: () => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let googleScriptPromise: Promise<void> | null = null;

const loadGoogleScript = () => {
  if (window.google?.accounts.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Googleログインを読み込めませんでした。")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Googleログインを読み込めませんでした。"));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
};

const readError = async (response: Response, fallback: string) => {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message || fallback;
  } catch {
    return fallback;
  }
};

export function AccountPanel({ onAccountChange }: { onAccountChange: () => Promise<void> }) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const [configured, setConfigured] = useState(false);
  const [clientId, setClientId] = useState("");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const loadAccount = async () => {
      try {
        const [configResponse, meResponse] = await Promise.all([
          fetch("/api/auth/config", { credentials: "same-origin" }),
          fetch("/api/me", { credentials: "same-origin" })
        ]);
        if (!configResponse.ok || !meResponse.ok) throw new Error("アカウント情報を確認できませんでした。");

        const config = await configResponse.json() as { configured?: boolean; clientId?: string | null };
        const me = await meResponse.json() as { authenticated?: boolean; user?: AccountUser | null };
        if (!active) return;
        setConfigured(config.configured === true && typeof config.clientId === "string");
        setClientId(typeof config.clientId === "string" ? config.clientId : "");
        setUser(me.authenticated ? me.user || null : null);
      } catch {
        if (active) {
          setConfigured(false);
          setMessage("");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadAccount();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loading || !configured || !clientId || user || !buttonRef.current) return;
    let active = true;

    const render = async () => {
      try {
        const nonceResponse = await fetch("/api/auth/nonce", { credentials: "same-origin" });
        if (!nonceResponse.ok) throw new Error(await readError(nonceResponse, "ログイン準備に失敗しました。"));
        const nonceBody = await nonceResponse.json() as { nonce?: string };
        if (!nonceBody.nonce) throw new Error("ログイン準備に失敗しました。");

        await loadGoogleScript();
        if (!active || !buttonRef.current || !window.google) return;
        buttonRef.current.replaceChildren();
        window.google.accounts.id.initialize({
          client_id: clientId,
          nonce: nonceBody.nonce,
          auto_select: false,
          callback: (response) => {
            void (async () => {
              setLoading(true);
              setMessage("");
              try {
                const loginResponse = await fetch("/api/auth/google", {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ credential: response.credential, nonce: nonceBody.nonce })
                });
                if (!loginResponse.ok) throw new Error(await readError(loginResponse, "Googleログインに失敗しました。"));
                const login = await loginResponse.json() as { user?: AccountUser };
                setUser(login.user || null);
                setMessage("Googleアカウントでログインしました。");
                await onAccountChange();
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Googleログインに失敗しました。");
              } finally {
                setLoading(false);
              }
            })();
          }
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
          logo_alignment: "left",
          locale: "ja",
          width: Math.min(320, Math.max(240, buttonRef.current.clientWidth || 280))
        });
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Googleログインを準備できませんでした。");
      }
    };

    void render();
    return () => {
      active = false;
    };
  }, [clientId, configured, loading, onAccountChange, user]);

  const handleLogout = async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(await readError(response, "ログアウトできませんでした。"));
      window.google?.accounts.id.disableAutoSelect();
      setUser(null);
      setMessage("ログアウトしました。ブラウザ内のライフプランデータは残っています。");
      await onAccountChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログアウトできませんでした。");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      "Googleログインの利用者情報とセッションを削除します。ブラウザ内のライフプランデータは削除されません。\n\nこの操作は取り消せません。続けますか？"
    );
    if (!confirmed) return;

    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE_ACCOUNT" })
      });
      if (!response.ok) throw new Error(await readError(response, "アカウント情報を削除できませんでした。"));
      window.google?.accounts.id.disableAutoSelect();
      setUser(null);
      setMessage("アカウント情報を削除しました。ブラウザ内のライフプランデータは残っています。");
      await onAccountChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "アカウント情報を削除できませんでした。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel account-panel" data-testid="account-panel">
      <div className="section-heading-row">
        <div>
          <h2>アカウント</h2>
          <p>GoogleログインはPro契約の本人確認に使います。無料版はログインなしで利用できます。</p>
        </div>
        <span className={`status-chip${user ? " complete" : ""}`}>{user ? "ログイン中" : "未ログイン"}</span>
      </div>

      {loading && <p className="muted">アカウント状態を確認しています。</p>}
      {!loading && user && (
        <div className="account-signed-in">
          <div>
            <span>Googleアカウント</span>
            <strong>{user.email || "メールアドレス非表示"}</strong>
            <small>利用者IDと契約状態だけをサーバー側で管理します。</small>
          </div>
          <div className="account-actions">
            <button type="button" className="secondary" data-testid="account-logout" onClick={handleLogout}>ログアウト</button>
            <button type="button" className="danger" data-testid="account-delete" onClick={handleDeleteAccount}>アカウント情報を削除</button>
          </div>
        </div>
      )}
      {!loading && !user && configured && <div ref={buttonRef} className="google-sign-in-button" data-testid="google-sign-in-slot" aria-label="Googleログイン" />}
      {!loading && !user && !configured && (
        <div className="notice-band">
          <strong>Googleログインは設定中です</strong>
          <span>設定完了までは、これまで通りログインなしで利用できます。</span>
        </div>
      )}

      <div className="account-privacy-note">
        <strong>ログインしても自動でクラウド保存しません</strong>
        <p>収入、支出、資産、家族、目標、イベントは引き続きこのブラウザ内に保存されます。</p>
      </div>
      {message && <p className="inline-message" role="status">{message}</p>}
    </section>
  );
}
