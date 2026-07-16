import { MAX_PLAN_YEAR } from "../config";
import { getTargetAgeForYear } from "../utils/calculations";
import { NumericInput } from "./CommonUi";

type YearAgeInputProps = {
  year: number;
  currentAge: number;
  ageLabel: string;
  onChange: (value: number) => void;
};

export function YearAgeInput({ year, currentAge, ageLabel, onChange }: YearAgeInputProps) {
  const currentYear = new Date().getFullYear();
  const targetAge = getTargetAgeForYear(currentAge, year);
  const updateYear = (value: number) => onChange(Math.max(currentYear, value));

  return (
    <div className="year-age-control">
      <div className="year-stepper">
        <button type="button" className="stepper-button" aria-label="1年早める" onClick={() => updateYear(year - 1)}>
          -
        </button>
        <NumericInput value={year} min={currentYear} max={MAX_PLAN_YEAR} onChange={updateYear} />
        <button type="button" className="stepper-button" aria-label="1年遅らせる" onClick={() => updateYear(year + 1)}>
          +
        </button>
      </div>
      <small>
        {ageLabel}: {targetAge}歳
      </small>
    </div>
  );
}
