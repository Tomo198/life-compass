import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    console.error(JSON.stringify({ event: "ui_render_error", errorName: error.name }));
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="app-error-fallback" role="alert">
        <section className="panel">
          <p className="eyebrow">Life Compass</p>
          <h1>画面を表示できませんでした</h1>
          <p>入力データはこのブラウザ内に残っています。ページを再読み込みしてから、もう一度お試しください。</p>
          <div className="button-row">
            <button type="button" onClick={() => window.location.reload()}>ページを再読み込み</button>
            <button type="button" className="secondary" onClick={() => window.location.assign("/data")}>
              データ管理を開く
            </button>
          </div>
        </section>
      </main>
    );
  }
}
