import { useEffect, useState } from "react";
import { manYen, type VariabilityResult } from "../utils/calculations";

export type ChartPoint = {
  year: number;
  month?: number;
  label?: string;
  value: number;
  age?: number;
  annualSavings?: number;
  monthlySavings?: number;
  eventImpact?: number;
  returnImpact?: number;
  eventTitles?: string[];
  impactLabel?: string;
  returnLabel?: string;
};

export function VariabilityBandChart({ rows }: { rows: VariabilityResult["rows"] }) {
  if (rows.length === 0) return null;

  const width = 900;
  const height = 300;
  const padding = { top: 38, right: 42, bottom: 48, left: 76 };
  const minValue = Math.min(...rows.map((row) => row.lower), ...rows.map((row) => row.mode), 0);
  const maxValue = Math.max(...rows.map((row) => row.upper), ...rows.map((row) => row.mode), 1);
  const valueRange = maxValue - minValue || 1;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xStep = chartWidth / Math.max(rows.length - 1, 1);
  const pointFor = (row: VariabilityResult["rows"][number], index: number, key: "lower" | "mode" | "median" | "upper") => ({
    x: padding.left + index * xStep,
    y: height - padding.bottom - ((row[key] - minValue) / valueRange) * chartHeight
  });
  const upperPoints = rows.map((row, index) => pointFor(row, index, "upper"));
  const lowerPoints = rows.map((row, index) => pointFor(row, index, "lower"));
  const modePoints = rows.map((row, index) => pointFor(row, index, "mode"));
  const medianPoints = rows.map((row, index) => pointFor(row, index, "median"));
  const bandPath = [
    ...upperPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`),
    ...lowerPoints.slice().reverse().map((point) => `L ${point.x} ${point.y}`),
    "Z"
  ].join(" ");
  const medianPath = medianPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const modePath = modePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const labelStep = rows.length > 20 ? 5 : rows.length > 12 ? 3 : 1;

  return (
    <div className="chart-block">
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="ばらつき試算の範囲グラフ">
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} className="axis" />
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} className="axis" />
          <text x={padding.left - 10} y={padding.top + 4} textAnchor="end" className="axis-label">{manYen(maxValue)}</text>
          <text x={padding.left - 10} y={height - padding.bottom + 4} textAnchor="end" className="axis-label">{manYen(minValue)}</text>
          <path d={bandPath} className="range-band" />
          <path d={medianPath} className="range-median-line" />
          <path d={modePath} className="range-mode-line" />
          {medianPoints.map((point, index) => {
            const row = rows[index];
            const showLabel = index % labelStep === 0 || index === rows.length - 1;
            return (
              <g key={`${row.label}-${index}`}>
                <circle cx={point.x} cy={point.y} r="3.5" className="range-dot" />
                {showLabel && <text x={point.x} y={height - 16} textAnchor="middle" className="year-label">{row.label}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="chart-legend" aria-label="グラフ凡例">
        <span><i className="legend-band" />下位10%〜上位10%</span>
        <span><i className="legend-median" />中央値</span>
        <span><i className="legend-mode" />最頻帯</span>
      </div>
    </div>
  );
}

export function LineChart({
  points,
  variabilityRows
}: {
  points: ChartPoint[];
  variabilityRows?: VariabilityResult["rows"];
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= points.length) setSelectedIndex(null);
  }, [points.length, selectedIndex]);

  if (points.length === 0) return null;

  const width = 900;
  const height = 330;
  const padding = { top: 54, right: 42, bottom: 50, left: 76 };
  const rangeRows = variabilityRows?.slice(0, points.length) ?? [];
  const fixedValues = rangeRows.length > 0 ? [] : points.map((point) => point.value);
  const minValue = Math.min(...fixedValues, ...rangeRows.map((row) => row.lower), ...rangeRows.map((row) => row.mode), 0);
  const maxValue = Math.max(...fixedValues, ...rangeRows.map((row) => row.upper), ...rangeRows.map((row) => row.mode), 1);
  const valueRange = maxValue - minValue || 1;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const xStep = chartWidth / Math.max(points.length - 1, 1);
  const coordinates = points.map((point, index) => {
    const x = padding.left + index * xStep;
    const plottedValue = rangeRows[index]?.median ?? point.value;
    const y = height - padding.bottom - ((plottedValue - minValue) / valueRange) * chartHeight;
    return { ...point, x, y, plottedValue };
  });
  const rangePointFor = (row: VariabilityResult["rows"][number], index: number, key: "lower" | "mode" | "median" | "upper") => ({
    x: padding.left + index * xStep,
    y: height - padding.bottom - ((row[key] - minValue) / valueRange) * chartHeight
  });
  const upperRangePoints = rangeRows.map((row, index) => rangePointFor(row, index, "upper"));
  const lowerRangePoints = rangeRows.map((row, index) => rangePointFor(row, index, "lower"));
  const modeRangePoints = rangeRows.map((row, index) => rangePointFor(row, index, "mode"));
  const medianRangePoints = rangeRows.map((row, index) => rangePointFor(row, index, "median"));
  const bandPath = rangeRows.length > 0
    ? [
        ...upperRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`),
        ...lowerRangePoints.slice().reverse().map((point) => `L ${point.x} ${point.y}`),
        "Z"
      ].join(" ")
    : "";
  const medianRangePath = medianRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const modeRangePath = modeRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const upperRangePath = upperRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const lowerRangePath = lowerRangePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const path = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const selectedPoint = selectedIndex === null ? null : coordinates[selectedIndex];
  const selectedRange = selectedIndex === null ? null : rangeRows[selectedIndex] ?? null;
  const previousPoint = selectedIndex !== null && selectedIndex > 0 ? coordinates[selectedIndex - 1] : undefined;
  const selectedRangeCoordinates = selectedIndex !== null && selectedRange
    ? {
        lower: rangePointFor(selectedRange, selectedIndex, "lower"),
        mode: rangePointFor(selectedRange, selectedIndex, "mode"),
        median: rangePointFor(selectedRange, selectedIndex, "median"),
        upper: rangePointFor(selectedRange, selectedIndex, "upper")
      }
    : null;
  const labelStep = points.length > 20 ? 5 : points.length > 12 ? 3 : 1;
  const selectedLabelY = selectedPoint ? (selectedPoint.y < padding.top + 28 ? selectedPoint.y + 26 : selectedPoint.y - 16) : 0;
  const selectedPointLabel = selectedPoint?.label ?? (selectedPoint ? `${selectedPoint.year}年` : "");
  const selectedAgeLabel = selectedPoint?.age ? `${selectedPoint.age}歳` : "";
  const shouldAppendSelectedAge = selectedAgeLabel !== "" && !selectedPointLabel.includes(selectedAgeLabel);
  const isMonthly = Boolean(selectedPoint && "monthlySavings" in selectedPoint);

  return (
    <div className="chart-block">
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="将来資産の見通しグラフ">
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} className="axis" />
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} className="axis" />
          <text x={padding.left - 10} y={padding.top + 4} textAnchor="end" className="axis-label">{manYen(maxValue)}</text>
          <text x={padding.left - 10} y={height - padding.bottom + 4} textAnchor="end" className="axis-label">{manYen(minValue)}</text>
          {rangeRows.length > 0 && (
            <>
              <path d={bandPath} className="range-band" />
              <path d={upperRangePath} className="range-upper-line" />
              <path d={lowerRangePath} className="range-lower-line" />
              <path d={medianRangePath} className="range-median-line" />
              <path d={modeRangePath} className="range-mode-line" />
            </>
          )}
          {rangeRows.length === 0 && <path d={path} className="chart-line" />}
          {selectedPoint && selectedRangeCoordinates && (
            <>
              <line x1={selectedPoint.x} y1={padding.top} x2={selectedPoint.x} y2={height - padding.bottom} className="chart-selected-guide" />
              <circle cx={selectedRangeCoordinates.upper.x} cy={selectedRangeCoordinates.upper.y} r="5" className="selected-range-dot upper" />
              <circle cx={selectedRangeCoordinates.lower.x} cy={selectedRangeCoordinates.lower.y} r="5" className="selected-range-dot lower" />
              <circle cx={selectedRangeCoordinates.mode.x} cy={selectedRangeCoordinates.mode.y} r="5" className="selected-range-dot mode" />
            </>
          )}
          {coordinates.map((point, index) => {
            const isSelected = selectedIndex === index;
            const isScheduledLabel = index % labelStep === 0 || index === coordinates.length - 1;
            const isNearSelectedLabel = selectedIndex !== null && !isSelected && Math.abs(index - selectedIndex) < labelStep;
            const showYearLabel = isSelected || (isScheduledLabel && !isNearSelectedLabel);
            const pointLabel = point.label ?? `${point.year}`;
            const pointValue = rangeRows[index]?.median ?? point.value;
            return (
              <g key={`${pointLabel}-${index}`}>
                <g
                  role="button"
                  tabIndex={0}
                  className="chart-hit-button"
                  aria-label={`${pointLabel} ${rangeRows[index] ? "中央値 " : ""}${manYen(pointValue)}`}
                  onClick={() => setSelectedIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedIndex(index);
                    }
                  }}
                >
                  <circle cx={point.x} cy={point.y} r="16" className="chart-hit-area" />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={isSelected ? "6" : rangeRows.length > 0 ? "3" : "4"}
                    className={`${isSelected ? "chart-dot selected" : "chart-dot"}${rangeRows.length > 0 ? " monte-carlo" : ""}`}
                  />
                </g>
                {isSelected && <text x={point.x} y={selectedLabelY} textAnchor="middle" className="point-value-label">{manYen(pointValue)}</text>}
                {showYearLabel && <text x={point.x} y={height - 16} textAnchor="middle" className="year-label">{pointLabel}</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {rangeRows.length > 0 && (
        <div className="chart-legend" aria-label="グラフの凡例">
          <span><i className="legend-upper" />上位10%</span>
          <span><i className="legend-lower" />下位10%</span>
          <span><i className="legend-median" />中央値</span>
          <span><i className="legend-mode" />最頻帯</span>
        </div>
      )}
      <div className="chart-selection-panel" aria-live="polite">
        {selectedPoint ? (
          <>
            <div>
              <span>{selectedPointLabel}{shouldAppendSelectedAge ? ` / ${selectedAgeLabel}` : ""}{selectedRange ? " / 中央値" : ""}</span>
              <strong>{manYen(selectedRange?.median ?? selectedPoint.value)}</strong>
            </div>
            {!selectedRange && <div><span>{isMonthly ? "前月差" : "前年差"}</span><strong>{previousPoint ? manYen(selectedPoint.value - previousPoint.value) : "-"}</strong></div>}
            {selectedRange && (
              <>
                <div><span>下位10%</span><strong>{manYen(selectedRange.lower)}</strong></div>
                <div><span>最頻帯</span><strong>{manYen(selectedRange.mode)}</strong></div>
                <div><span>上位10%</span><strong>{manYen(selectedRange.upper)}</strong></div>
              </>
            )}
            {!selectedRange && "annualSavings" in selectedPoint && <div><span>年間貯蓄</span><strong>{selectedPoint.annualSavings ? manYen(selectedPoint.annualSavings) : "-"}</strong></div>}
            {!selectedRange && "monthlySavings" in selectedPoint && <div><span>月間貯蓄</span><strong>{selectedPoint.monthlySavings ? manYen(selectedPoint.monthlySavings) : "-"}</strong></div>}
            {"eventImpact" in selectedPoint && <div><span>{selectedPoint.impactLabel ?? "イベント影響"}</span><strong>{selectedPoint.eventImpact ? manYen(selectedPoint.eventImpact) : "-"}</strong></div>}
            {!selectedRange && "returnImpact" in selectedPoint && <div><span>{selectedPoint.returnLabel ?? "利回り等の影響"}</span><strong>{selectedPoint.returnImpact ? manYen(selectedPoint.returnImpact) : "-"}</strong></div>}
            {selectedPoint.eventTitles && selectedPoint.eventTitles.length > 0 && <div className="chart-selection-wide"><span>イベント</span><strong>{selectedPoint.eventTitles.join(" / ")}</strong></div>}
          </>
        ) : (
          <p>グラフ上の点をタップすると、その時点の試算額を確認できます。</p>
        )}
      </div>
    </div>
  );
}
