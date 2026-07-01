import { useEffect, useRef, useState } from "react";
import type { ViewKey } from "../types";

const normalizeNumericText = (value: string, allowDecimal = false) => {
  const withoutCommas = value.replace(/,/g, "");
  const allowed = withoutCommas.replace(allowDecimal ? /[^\d.-]/g : /[^\d-]/g, "");
  const sign = allowed.startsWith("-") ? "-" : "";
  const unsigned = allowed.replace(/-/g, "");

  if (!allowDecimal) return `${sign}${unsigned}`;

  const [integerPart, ...decimalParts] = unsigned.split(".");
  const decimal = decimalParts.join("");
  return decimalParts.length > 0 ? `${sign}${integerPart}.${decimal}` : `${sign}${integerPart}`;
};

const parseNumericText = (value: string) => {
  const normalized = value.replace(/,/g, "");
  if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clampNumber = (value: number, min?: number, max?: number) => {
  if (typeof min === "number" && value < min) return min;
  if (typeof max === "number" && value > max) return max;
  return value;
};

const formatNumericText = (value: number, allowDecimal = false) =>
  new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits: allowDecimal ? 2 : 0
  }).format(value || 0);

export function Metric({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function StepFlowNav({
  previous,
  next,
  setActiveView
}: {
  previous?: { view: ViewKey; label: string };
  next?: { view: ViewKey; label: string };
  setActiveView: (view: ViewKey) => void;
}) {
  return (
    <section className="step-flow-nav" aria-label="入力の移動">
      {previous ? (
        <button type="button" className="secondary" onClick={() => setActiveView(previous.view)}>
          前へ: {previous.label}
        </button>
      ) : (
        <span />
      )}
      {next && (
        <button type="button" onClick={() => setActiveView(next.view)}>
          次へ: {next.label}
        </button>
      )}
    </section>
  );
}

export function DisclaimerPanel() {
  return (
    <section className="panel legal-section">
      <h2>免責事項</h2>
      <ul>
        <li>このアプリは教育・参考目的のライフプラン管理ツールです。</li>
        <li>表示される結果は入力条件に基づく試算です。</li>
        <li>投資助言、税務助言、法律助言、保険助言ではありません。</li>
        <li>個別の金融商品、銘柄、保険商品等を推奨しません。</li>
        <li>実際の判断は必要に応じて専門家に相談してください。</li>
        <li>将来の収益や資産形成を保証するものではありません。</li>
      </ul>
    </section>
  );
}

export function StepTitle({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="step-title">
      <span>{step}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label>
      {label}
      <NumericInput value={value} min={0} onChange={onChange} />
    </label>
  );
}

export function NumericInput({
  value,
  onChange,
  min,
  max,
  allowDecimal = false
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  allowDecimal?: boolean;
}) {
  const initialDraft = formatNumericText(value, allowDecimal);
  const [draft, setDraft] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      const formatted = formatNumericText(value, allowDecimal);
      draftRef.current = formatted;
      setDraft(formatted);
    }
  }, [allowDecimal, isFocused, value]);

  const commitDraft = (nextDraft: string) => {
    const normalized = normalizeNumericText(nextDraft, allowDecimal);
    draftRef.current = normalized;
    setDraft(normalized);
    onChange(clampNumber(parseNumericText(normalized), min, max));
  };

  return (
    <input
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={draft}
      onFocus={(event) => {
        setIsFocused(true);
        if (value === 0) {
          draftRef.current = "";
          setDraft("");
        } else {
          event.currentTarget.select();
        }
      }}
      onChange={(event) => commitDraft(event.target.value)}
      onBlur={() => {
        setIsFocused(false);
        const nextValue = clampNumber(parseNumericText(draftRef.current), min, max);
        onChange(nextValue);
        const formatted = formatNumericText(nextValue, allowDecimal);
        draftRef.current = formatted;
        setDraft(formatted);
      }}
    />
  );
}
