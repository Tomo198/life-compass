import { useState } from "react";
import { householdMemberRelationshipLabels } from "../data/householdMembers";
import { manYen, type AnnualProjectionRow } from "../utils/calculations";

const memberAgeLabel = (member: AnnualProjectionRow["memberAges"][number]) => {
  if (member.status === "beforeBirth") return "誕生前";
  if (member.status === "unknown" || member.age === null) return "生年未設定";
  return `${member.age}歳`;
};

export function AnnualCashflowTable({
  rows,
  selectedYear,
  onSelectYear
}: {
  rows: AnnualProjectionRow[];
  selectedYear?: number | null;
  onSelectYear?: (year: number | null) => void;
}) {
  const [internalExpandedYear, setInternalExpandedYear] = useState<number | null>(null);
  const expandedYear = selectedYear === undefined ? internalExpandedYear : selectedYear;
  const toggleYear = (year: number) => {
    const nextYear = expandedYear === year ? null : year;
    if (onSelectYear) {
      onSelectYear(nextYear);
      return;
    }
    setInternalExpandedYear(nextYear);
  };

  return (
    <div className="annual-ledger" data-testid="annual-cashflow-ledger">
      <div className="annual-ledger-header" aria-hidden="true">
        <span>時点 / 世帯年齢</span>
        <span>12か月収入</span>
        <span>12か月支出</span>
        <span>収支</span>
        <span>純資産見通し</span>
        <span>内訳</span>
      </div>
      {rows.map((row, index) => {
        const expanded = expandedYear === row.year;
        const primaryMember = row.memberAges.find((member) => member.relationship === "self");
        const detailId = `annual-cashflow-${row.year}`;
        return (
          <div className={`annual-ledger-row${expanded ? " expanded" : ""}`} key={`${row.year}-${row.age}`}>
            <button
              type="button"
              className="annual-ledger-summary"
              aria-expanded={expanded}
              aria-controls={detailId}
              onClick={() => toggleYear(row.year)}
            >
              <span className="annual-ledger-year">
                <strong>{row.year}年時点</strong>
                <small>
                  現在から{index + 1}年後 / {primaryMember ? memberAgeLabel(primaryMember) : `${row.age}歳`}
                </small>
                {row.memberAges.length > 1 && <small>世帯 {row.memberAges.length}人</small>}
              </span>
              <span data-label="12か月収入">{manYen(row.annualIncome + row.eventIncome)}</span>
              <span data-label="12か月支出">{manYen(row.annualLivingCost + row.eventExpense)}</span>
              <span data-label="収支" className={row.netCashflow < 0 ? "negative-value" : ""}>
                {manYen(row.netCashflow)}
              </span>
              <span data-label="純資産見通し">{manYen(row.value)}</span>
              <span className="annual-ledger-toggle" aria-hidden="true">{expanded ? "−" : "＋"}</span>
            </button>
            {expanded && (
              <div className="annual-ledger-detail" id={detailId}>
                <div className="annual-ledger-members">
                  <strong>世帯年齢</strong>
                  <div>
                    {row.memberAges.map((member) => (
                      <span key={member.id}>
                        {member.displayName}（{householdMemberRelationshipLabels[member.relationship]}） {memberAgeLabel(member)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="annual-ledger-breakdowns">
                  <div className="annual-ledger-breakdown">
                    <h4>収入の内訳</h4>
                    <dl>
                      <div><dt>給与など</dt><dd>{manYen(row.incomeBreakdown.mainIncome)}</dd></div>
                      <div><dt>副業収入</dt><dd>{manYen(row.incomeBreakdown.sideIncome)}</dd></div>
                      <div><dt>ボーナス</dt><dd>{manYen(row.incomeBreakdown.bonus)}</dd></div>
                      <div><dt>収入イベント</dt><dd>{manYen(row.incomeBreakdown.eventIncome)}</dd></div>
                    </dl>
                  </div>
                  <div className="annual-ledger-breakdown">
                    <h4>支出の内訳</h4>
                    <dl>
                      <div><dt>固定費</dt><dd>{manYen(row.expenseBreakdown.fixedCost)}</dd></div>
                      <div><dt>変動費</dt><dd>{manYen(row.expenseBreakdown.variableCost)}</dd></div>
                      <div><dt>年間特別支出</dt><dd>{manYen(row.expenseBreakdown.annualSpecialCost)}</dd></div>
                      <div><dt>支出イベント</dt><dd>{manYen(row.expenseBreakdown.eventExpense)}</dd></div>
                    </dl>
                  </div>
                  <div className="annual-ledger-breakdown">
                    <h4>残高の内訳</h4>
                    <dl>
                      <div><dt>現金</dt><dd>{manYen(row.cashBalance)}</dd></div>
                      <div><dt>投資資産</dt><dd>{manYen(row.investmentBalance)}</dd></div>
                      <div><dt>利回り等の影響</dt><dd>{manYen(row.returnImpact)}</dd></div>
                      <div><dt>純資産見通し</dt><dd>{manYen(row.value)}</dd></div>
                    </dl>
                  </div>
                </div>
                <div className="annual-ledger-notes">
                  <div>
                    <strong>時期別の変更</strong>
                    <span>
                      {row.cashflowChangeTitles.length > 0
                        ? row.cashflowChangeTitles.join(" / ")
                        : "この区間に適用される変更はありません"}
                    </span>
                  </div>
                  <div>
                    <strong>ライフイベント</strong>
                    <span>
                      {row.eventTitles.length > 0
                        ? row.eventTitles.join(" / ")
                        : "この区間の収支イベントはありません"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
