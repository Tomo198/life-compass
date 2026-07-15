import type { FixedCostCategory, FixedCostItem } from "../types";
import { manYen } from "../utils/calculations";
import { EmptyState, MoneyInput } from "./CommonUi";

const fixedCostCategoryLabels: Record<FixedCostCategory, string> = {
  insurance: "保険",
  communication: "通信費",
  rent: "家賃",
  car: "車",
  subscription: "サブスク",
  utilities: "光熱費",
  loan: "ローン",
  other: "その他"
};

type FixedCostItemListProps = {
  items: FixedCostItem[];
  updateFixedCostItem: <K extends keyof FixedCostItem>(id: string, key: K, value: FixedCostItem[K]) => void;
  removeFixedCostItem: (id: string) => void;
};

export function FixedCostItemList({
  items,
  updateFixedCostItem,
  removeFixedCostItem
}: FixedCostItemListProps) {
  if (items.length === 0) {
    return <EmptyState title="固定費見直し項目はまだありません" detail="項目を追加すると、月額差分と長期の単純差額を確認できます。" />;
  }

  return (
    <div className="fixed-cost-list">
      {items.map((item) => (
        <div className="fixed-cost-row" key={item.id}>
          <label>
            項目名
            <input value={item.name} onChange={(event) => updateFixedCostItem(item.id, "name", event.target.value)} />
          </label>
          <label>
            種類
            <select value={item.category} onChange={(event) => updateFixedCostItem(item.id, "category", event.target.value as FixedCostCategory)}>
              {Object.entries(fixedCostCategoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <MoneyInput
            label="現在の月額"
            value={item.currentMonthlyCost}
            onChange={(value) => updateFixedCostItem(item.id, "currentMonthlyCost", value)}
          />
          <MoneyInput
            label="見直し後の月額"
            value={item.revisedMonthlyCost}
            onChange={(value) => updateFixedCostItem(item.id, "revisedMonthlyCost", value)}
          />
          <label>
            メモ
            <input value={item.memo} onChange={(event) => updateFixedCostItem(item.id, "memo", event.target.value)} />
          </label>
          <div className="fixed-cost-impact-cell">
            <span>月額差</span>
            <strong>{manYen(Math.max(0, item.currentMonthlyCost - item.revisedMonthlyCost))}</strong>
          </div>
          <button type="button" className="text-button" onClick={() => removeFixedCostItem(item.id)}>
            削除
          </button>
        </div>
      ))}
    </div>
  );
}
