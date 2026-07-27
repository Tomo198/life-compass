import { expect, test, type Page } from "@playwright/test";
import { MAX_PLAN_YEAR } from "../../src/config";
import { defaultPlan } from "../../src/data/defaultPlan";
import type { BudgetCategory, LifePlan } from "../../src/types";
import { encryptSharedPlan } from "../../src/utils/sharedPlanCrypto";

const uncaughtPageErrors = new WeakMap<Page, Error[]>();

const mobilePrimaryViews: Partial<Record<string, string>> = {
  dashboard: "home",
  household: "household",
  goals: "goals",
  simulation: "forecast"
};

const openView = async (page: Page, view: string) => {
  if ((page.viewportSize()?.width || 999) > 720) {
    await page.locator(`.sidebar [data-view="${view}"]`).click();
    return;
  }

  const primaryKey = mobilePrimaryViews[view];
  if (primaryKey) {
    await page.locator(`[data-mobile-nav="${primaryKey}"]`).click();
    return;
  }

  const menuButton = page.locator('[data-mobile-nav="menu"]');
  if (await menuButton.getAttribute("aria-expanded") !== "true") {
    await menuButton.click();
  }
  await page.locator(`.sidebar [data-view="${view}"]`).click();
};

test.beforeEach(async ({ page }) => {
  const errors: Error[] = [];
  uncaughtPageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error));
  await page.route("**/api/entitlement", (route) => route.fulfill({
    json: { access: { tier: "free", mode: "preview", source: "local-preview" } }
  }));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.afterEach(async ({ page }) => {
  expect(uncaughtPageErrors.get(page) || []).toEqual([]);
});

test("基本入力が画面移動と再読み込み後も保存される", async ({ page }) => {
  await openView(page, "profile");
  await page.getByLabel("プラン名").fill("E2E確認プラン");
  const ageInput = page.getByLabel("現在の年齢");
  await ageInput.fill("42");
  await ageInput.blur();
  const primaryBirthYear = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    return plan.householdMembers?.find((member: { relationship: string }) => member.relationship === "self")?.birthYear;
  });
  expect(primaryBirthYear).toBe(new Date().getFullYear() - 42);

  await openView(page, "household");
  const incomeInput = page.getByLabel("月収");
  await incomeInput.fill("450000");
  await incomeInput.blur();
  await expect(incomeInput).toHaveValue("450,000");

  await page.reload();
  await openView(page, "profile");
  await expect(page.getByLabel("プラン名")).toHaveValue("E2E確認プラン");
  await expect(page.getByLabel("現在の年齢")).toHaveValue("42");
  await openView(page, "household");
  await expect(page.getByLabel("月収")).toHaveValue("450,000");
});

test("世帯全体の収支を家族ごとの入力へ同値変換し、期間は必要なときだけ設定できる", async ({ page }) => {
  await openView(page, "household");
  await page.getByRole("button", { name: "家族ごとに入力", exact: true }).click();

  const converted = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    const currentYear = new Date().getFullYear();
    const totals = Object.fromEntries([
      "monthlyIncome",
      "annualBonus",
      "sideIncome",
      "fixedCost",
      "variableCost",
      "annualSpecialCost"
    ].map((target) => [
      target,
      (plan.detailedCashflowItems || [])
        .filter((item: { target: string; startYear: number; endYear: number }) =>
          item.target === target && item.startYear <= currentYear && currentYear <= item.endYear
        )
        .reduce((total: number, item: { amount: number }) => total + item.amount, 0)
    ]));
    return { mode: plan.cashflowMode, household: plan.household, totals };
  });
  expect(converted.mode).toBe("detailed");
  expect(converted.totals).toEqual(converted.household);
  await expect(page.getByRole("textbox", { name: "月収", exact: true })).toBeDisabled();

  const form = page.getByTestId("detailed-cashflow-create-form");
  await expect(form.getByLabel("誰の収支ですか？")).toContainText("世帯共通");
  await expect(form.getByLabel("開始年")).toHaveCount(0);
  await expect(form.getByText("今から継続", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "将来変わる予定", exact: true }).click();
  await expect(form.getByLabel("開始年")).toBeVisible();
  await expect(form.getByLabel("終了年")).toBeVisible();
  await form.getByRole("button", { name: "将来変わる予定", exact: true }).click();
  await expect(form.getByLabel("開始年")).toHaveCount(0);
  await form.getByLabel("項目名").fill("配偶者の収入");
  await form.getByLabel("金額（月額）").fill("50000");
  await form.getByRole("button", { name: "収支項目を登録", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("配偶者の収入");
  await expect(page.locator(".detailed-cashflow-list")).toContainText("配偶者の収入");
  const addedItem = page.locator(".scenario-record-editor").filter({ hasText: "配偶者の収入" });
  await addedItem.locator(":scope > summary").click();
  await expect(addedItem.getByLabel("開始年")).not.toBeVisible();
  await addedItem.locator(".cashflow-schedule-details > summary").click();
  await expect(addedItem.getByLabel("開始年")).toBeVisible();
  const savedSchedule = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    const item = plan.detailedCashflowItems.find((entry: { title: string }) => entry.title === "配偶者の収入");
    return { startYear: item.startYear, endYear: item.endYear };
  });
  expect(savedSchedule).toEqual({
    startYear: new Date().getFullYear(),
    endYear: MAX_PLAN_YEAR
  });

  await page.reload();
  await openView(page, "household");
  await expect(page.getByRole("button", { name: "家族ごとに入力", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".detailed-cashflow-list")).toContainText("配偶者の収入");

  await page.getByRole("button", { name: "世帯全体で入力", exact: true }).click();
  await expect(page.getByLabel("月収")).toBeEnabled();
  await expect(page.getByText("時期別の収入・支出", { exact: true })).toBeVisible();
});

test("詳細収支のシナリオを基本プランと分けて編集・保存できる", async ({ page }) => {
  await openView(page, "household");
  await page.getByRole("button", { name: "家族ごとに入力", exact: true }).click();
  const baseCount = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    return plan.detailedCashflowItems.length;
  });

  await openView(page, "scenarios");
  await page.getByRole("button", { name: "現状維持", exact: true }).click();
  await page.getByLabel("編集するプラン").selectOption({ label: "現状維持" });
  const scenarioTabs = page.locator(".scenario-editor-tabs");
  await scenarioTabs.getByRole("button", { name: /詳細収支/ }).click();

  const form = page.getByTestId("detailed-cashflow-create-form");
  await form.getByLabel("項目名").fill("シナリオ内の副業収入");
  await form.getByLabel("何を入力しますか？").selectOption("sideIncome");
  await form.getByLabel("金額（月額）").fill("40000");
  await form.getByRole("button", { name: "収支項目を登録", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("シナリオ内の副業収入");

  const saved = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    return {
      baseCount: plan.detailedCashflowItems.length,
      scenarioCount: plan.scenarios[0].snapshot.detailedCashflowItems.length,
      hasScenarioItem: plan.scenarios[0].snapshot.detailedCashflowItems.some(
        (item: { title: string }) => item.title === "シナリオ内の副業収入"
      )
    };
  });
  expect(saved.baseCount).toBe(baseCount);
  expect(saved.scenarioCount).toBe(baseCount + 1);
  expect(saved.hasScenarioItem).toBe(true);

  await page.reload();
  await openView(page, "scenarios");
  await page.getByLabel("編集するプラン").selectOption({ label: "現状維持" });
  await page.locator(".scenario-editor-tabs").getByRole("button", { name: /詳細収支/ }).click();
  await expect(page.locator(".detailed-cashflow-list")).toContainText("シナリオ内の副業収入");
});

test("世帯メンバーを追加・編集・削除して再読み込み後も確認できる", async ({ page }) => {
  await openView(page, "profile");
  const memberForm = page.getByTestId("household-member-create-form");
  await memberForm.getByLabel("呼び名").fill("子どもA");
  await memberForm.getByLabel("続柄").selectOption("child");
  await memberForm.getByLabel("生まれた年").fill("2020");
  await memberForm.getByLabel("生まれた月").selectOption("4");
  await memberForm.getByRole("button", { name: "メンバーを追加", exact: true }).click();
  await expect(memberForm.getByRole("status")).toContainText("子どもAを追加しました");

  const memberRow = page.locator(".household-member-row").filter({ hasText: "子どもA" });
  await expect(memberRow).toHaveCount(1);
  await expect(page.getByLabel("世帯メンバー2の生まれた年")).toHaveValue("2020");
  await expect(page.getByLabel("世帯メンバー2の生まれた月")).toHaveValue("4");

  await page.reload();
  await openView(page, "profile");
  await expect(page.locator(".household-member-row").filter({ hasText: "子どもA" })).toHaveCount(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".household-member-row").filter({ hasText: "子どもA" }).getByRole("button", { name: "削除" }).click();
  await expect(page.locator(".household-member-row").filter({ hasText: "子どもA" })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("JSONの書き出し・初期化前復旧・読み込みを行える", async ({ page }) => {
  await openView(page, "profile");
  await page.getByLabel("プラン名").fill("復旧確認プラン");
  await openView(page, "data");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSONエクスポート", exact: true }).last().click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "空のプランを作成" }).click();
  await expect(page.getByText("復旧用コピー", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "この状態へ戻す" })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "この状態へ戻す" }).click();
  await openView(page, "profile");
  await expect(page.getByLabel("プラン名")).toHaveValue("復旧確認プラン");

  await openView(page, "data");
  await page.getByTestId("json-import-input").setInputFiles(downloadPath!);
  await expect(page.getByRole("status")).toContainText("JSONをインポートしました");

  const futurePlan = await page.evaluate(() => JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}"));
  futurePlan.version = 999;
  await page.getByTestId("json-import-input").setInputFiles({
    name: "future-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(futurePlan))
  });
  await expect(page.getByRole("status")).toContainText("新しいバージョン");
});

test("ブラウザ保存に失敗した場合は画面上へ通知する", async ({ page }) => {
  await openView(page, "profile");
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === "life-compass-plan-v1") throw new Error("quota");
      return originalSetItem.call(this, key, value);
    };
  });

  await page.getByLabel("プラン名").fill("保存失敗確認");
  await expect(page.getByRole("alert")).toContainText("ブラウザ内への保存を確認してください");
  await expect(page.getByRole("button", { name: "バックアップ・復元を開く" })).toBeVisible();
});

test("目標とイベントは入力後に登録され、再読み込み後も残る", async ({ page }) => {
  const goalTitle = "E2E住宅購入目標";
  const eventTitle = "E2E引越し予定";

  await openView(page, "goals");
  const goalForm = page.getByTestId("goal-create-form");
  const registeredGoalTitles = page.locator(".goal-table tbody td:first-child input");
  await expect(goalForm).toBeVisible();
  const initialGoalCount = await registeredGoalTitles.count();
  await goalForm.getByLabel("目標名").fill(goalTitle);
  await expect(registeredGoalTitles).toHaveCount(initialGoalCount);
  await goalForm.getByRole("button", { name: "目標を登録", exact: true }).click();
  await expect(goalForm.getByRole("status")).toContainText(`${goalTitle}」を登録しました`);
  await expect(registeredGoalTitles).toHaveCount(initialGoalCount + 1);
  await expect.poll(() => registeredGoalTitles.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toContain(goalTitle);
  await expect(page.getByText("テンプレートから追加", { exact: true })).toHaveCount(0);

  await openView(page, "events");
  const eventForm = page.getByTestId("event-create-form");
  const registeredEventTitles = page.locator(".timeline-row .title-field input");
  await expect(eventForm).toBeVisible();
  const initialEventCount = await registeredEventTitles.count();
  await eventForm.getByLabel("イベント名").fill(eventTitle);
  await expect(registeredEventTitles).toHaveCount(initialEventCount);
  await eventForm.getByRole("button", { name: "イベントを登録", exact: true }).click();
  await expect(eventForm.getByRole("status")).toContainText(`${eventTitle}」を登録しました`);
  await expect(registeredEventTitles).toHaveCount(initialEventCount + 1);
  await expect.poll(() => registeredEventTitles.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toContain(eventTitle);
  await expect(page.getByText("テンプレートから追加", { exact: true })).toHaveCount(0);

  await page.reload();
  await openView(page, "goals");
  await expect.poll(() => registeredGoalTitles.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toContain(goalTitle);
  await openView(page, "events");
  await expect.poll(() => registeredEventTitles.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toContain(eventTitle);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("予算実績、イベント設定、月別年表、保存容量を整理して確認できる", async ({ page }) => {
  await openView(page, "budget");
  await expect(page.getByText("月平均予算の全体像", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "予算項目を登録", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "予算入力", exact: true })).toHaveAttribute("aria-pressed", "true");

  const budgetForm = page.getByTestId("budget-create-form");
  const registeredBudgetRows = page.getByTestId("budget-item-row");
  await expect(registeredBudgetRows).toHaveCount(4);
  await budgetForm.getByLabel("項目名").fill("教育費");
  await budgetForm.getByLabel("カテゴリ").selectOption("education");
  await budgetForm.getByLabel("予算額").fill("25000");
  await budgetForm.getByLabel("メモ").fill("月ごとの学習費");
  await expect(registeredBudgetRows).toHaveCount(4);
  await budgetForm.getByRole("button", { name: "予算項目を登録", exact: true }).click();
  await expect(registeredBudgetRows).toHaveCount(5);
  await expect(budgetForm.getByRole("status")).toContainText("教育費");

  await page.getByRole("button", { name: "実績入力", exact: true }).click();
  await expect(page.getByRole("button", { name: "実績入力", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "予算入力", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { name: /実績入力/ })).toBeVisible();
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  const previousYear = currentYear - 1;
  await expect(page.locator('input[type="month"]')).toHaveCount(0);
  await expect(page.getByLabel("実績を確認する年", { exact: true })).toHaveValue(String(currentYear));
  await expect(page.getByLabel("実績を確認する月", { exact: true })).toHaveValue(String(currentMonth));
  await page.getByLabel("項目を検索").fill("食費");
  await expect(page.locator(".monthly-actual-row")).toHaveCount(1);
  const foodActualInput = page.locator(".monthly-actual-row").getByLabel("実際に使った額");
  await foodActualInput.fill("50000");
  await expect(page.getByText(/実績の全体像/)).toBeVisible();
  await expect(page.getByText("1/5項目入力済み。実績は月ごとにブラウザ内へ保存されます。")).toBeVisible();
  await foodActualInput.fill("");
  await expect(foodActualInput).toHaveValue("");
  await expect(page.getByText("0/5項目入力済み。実績は月ごとにブラウザ内へ保存されます。")).toBeVisible();
  await foodActualInput.fill("50000");
  await page.getByLabel("実績を確認する年", { exact: true }).selectOption(String(previousYear));
  await page.getByLabel("実績を確認する月", { exact: true }).selectOption("12");
  await expect(page.getByRole("heading", { name: `${previousYear}-12の実績入力`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "翌月", exact: true }).click();
  await expect(page.getByLabel("実績を確認する年", { exact: true })).toHaveValue(String(currentYear));
  await expect(page.getByLabel("実績を確認する月", { exact: true })).toHaveValue("1");
  await page.getByLabel("実績を確認する年", { exact: true }).selectOption(String(previousYear));
  await page.getByLabel("実績を確認する月", { exact: true }).selectOption("12");
  await expect(foodActualInput).toHaveValue("");
  await foodActualInput.fill("12345");
  await page.getByRole("button", { name: "今月", exact: true }).click();
  await expect(page.getByLabel("実績を確認する年", { exact: true })).toHaveValue(String(currentYear));
  await expect(page.getByLabel("実績を確認する月", { exact: true })).toHaveValue(String(currentMonth));
  await expect(foodActualInput).toHaveValue("50,000");
  await page.getByLabel("項目を検索").fill("");
  await page.getByRole("button", { name: "予算・実績比較", exact: true }).click();
  await expect(page.getByRole("heading", { name: /予算・実績比較/ })).toBeVisible();
  await expect(page.getByLabel("カテゴリ別予算実績比較表")).toBeVisible();
  await page.getByRole("button", { name: "年間推移", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${currentYear}年の予算・実績推移`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "前月", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "前年を表示", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${previousYear}年の予算・実績推移`, exact: true })).toBeVisible();
  await expect(page.getByText(`${previousYear}年は1/12か月に実績入力があります。`, { exact: true })).toBeVisible();
  await expect(page.getByText("1/12か月に実績入力あり", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "今年", exact: true }).click();
  await expect(page.getByLabel("表示する年", { exact: true })).toHaveValue(String(currentYear));

  await page.getByRole("button", { name: "予算入力", exact: true }).click();
  const foodBudgetRow = page.locator('div[data-testid="budget-item-row"]:has(input[value="食費"])');
  await expect(foodBudgetRow).toHaveCount(1);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("2か月分の実績もすべて削除されます");
    expect(dialog.message()).toContain("元に戻せません");
    await dialog.dismiss();
  });
  await foodBudgetRow.getByRole("button", { name: "「食費」を削除", exact: true }).click();
  await expect(foodBudgetRow).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await foodBudgetRow.getByRole("button", { name: "「食費」を削除", exact: true }).click();
  await expect(foodBudgetRow).toHaveCount(0);

  await openView(page, "events");
  await expect(page.getByRole("heading", { name: "イベント設定", exact: true, level: 1 })).toBeVisible();
  await expect(page.locator(".life-calendar")).toHaveCount(0);

  await openView(page, "notes");
  await page.getByRole("button", { name: "予定メモを追加" }).click();
  const memoRow = page.locator(".timeline-memo-row").last();
  await memoRow.getByLabel("タイトル").fill("更新時期を確認");
  await memoRow.getByLabel("内容").fill("家計の前提を見直す");

  await openView(page, "timeline");
  await expect(page.getByRole("heading", { name: "年表", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("更新時期を確認", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".calendar-month-card")).toHaveCount(12);
  const nextYear = new Date().getFullYear() + 1;
  await page.getByLabel("表示する年", { exact: true }).selectOption(String(nextYear));
  await expect(page.getByText(`${nextYear}年 年間カレンダー`, { exact: true })).toBeVisible();

  await openView(page, "data");
  await expect(page.getByText("ブラウザ内データの使用目安", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("予算項目が50件でも12カテゴリの構成と比較を崩さず表示できる", async ({ page }) => {
  const currentDate = new Date();
  const monthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}`;
  const categories: BudgetCategory[] = [
    "food",
    "daily",
    "housing",
    "utilities",
    "communication",
    "insurance",
    "car",
    "education",
    "medical",
    "travel",
    "subscription",
    "other"
  ];
  const loadPlan = structuredClone(defaultPlan);
  loadPlan.budgetItems = Array.from({ length: 50 }, (_, index) => {
    const budgetAmount = 10000 + index * 1000;
    return {
      id: `budget-load-${index + 1}`,
      name: `確認項目${index + 1}`,
      category: categories[index % categories.length],
      frequency: "monthlyVariable",
      budgetAmount,
      actuals: index === 0
        ? { [monthKey]: budgetAmount + 500, "1900-01": budgetAmount, "2300-12": budgetAmount }
        : { [monthKey]: budgetAmount + 500 },
      memo: "多数項目の表示確認"
    };
  });
  await page.evaluate((plan) => {
    localStorage.setItem("life-compass-plan-v1", JSON.stringify(plan));
  }, loadPlan);
  await page.reload();
  await openView(page, "budget");

  await expect(page.getByText("12カテゴリ / 50項目", { exact: true })).toBeVisible();
  await expect(page.locator(".budget-composition-bar > span")).toHaveCount(12);
  await expect(page.locator(".budget-composition-legend > div")).toHaveCount(12);
  const budgetChartGeometry = await page.locator(".budget-composition-bar").evaluate((bar) => {
    const barWidth = bar.getBoundingClientRect().width;
    const segmentWidths = Array.from(bar.children).map((segment) => segment.getBoundingClientRect().width);
    return {
      barWidth,
      segmentWidthTotal: segmentWidths.reduce((total, width) => total + width, 0),
      smallestSegmentWidth: Math.min(...segmentWidths)
    };
  });
  expect(budgetChartGeometry.smallestSegmentWidth).toBeGreaterThan(0);
  expect(Math.abs(budgetChartGeometry.segmentWidthTotal - budgetChartGeometry.barWidth)).toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "実績入力", exact: true }).click();
  await expect(page.getByText("50/50項目入力済み", { exact: true })).toBeVisible();
  await expect(page.locator(".budget-composition-bar > span")).toHaveCount(12);
  await expect(page.locator(".budget-composition-legend > div")).toHaveCount(12);
  await page.getByLabel("実績を確認する年", { exact: true }).selectOption("1900");
  await page.getByLabel("実績を確認する月", { exact: true }).selectOption("1");
  await expect(page.getByRole("button", { name: "前月", exact: true })).toBeDisabled();
  await page.getByLabel("実績を確認する年", { exact: true }).selectOption("2300");
  await page.getByLabel("実績を確認する月", { exact: true }).selectOption("12");
  await expect(page.getByRole("button", { name: "翌月", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "今月", exact: true }).click();

  await page.getByRole("button", { name: "予算・実績比較", exact: true }).click();
  await expect(page.locator(".budget-comparison-row")).toHaveCount(12);
  await page.getByRole("button", { name: "年間推移", exact: true }).click();
  await page.getByLabel("表示する年", { exact: true }).selectOption("1900");
  await expect(page.getByRole("button", { name: "前年を表示", exact: true })).toBeDisabled();
  await page.getByLabel("表示する年", { exact: true }).selectOption("2300");
  await expect(page.getByRole("button", { name: "翌年を表示", exact: true })).toBeDisabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("無料版とPro版の境界が表示され、横方向にはみ出さない", async ({ page }, testInfo) => {
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-mode", "preview");
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-tier", "free");
  await openView(page, "household");
  await expect(page.getByText("Proプレビュー", { exact: true }).first()).toBeVisible();
  await openView(page, "simulation");
  await expect(page.getByRole("button", { name: "積立試算" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取り崩し試算" })).toBeVisible();
  await openView(page, "retirement");
  await expect(page.getByRole("heading", { name: "老後プラン", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "年金・社会保険・税金を含めた取り崩し見通し", level: 2 })).toBeVisible();
  await openView(page, "reviews");
  await expect(page.getByRole("heading", { name: "レビューセンター", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "今月のレビューを作成", exact: true })).toBeVisible();
  await openView(page, "diagnosis");
  await expect(page.getByRole("heading", { name: "ライフプラン診断", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "確認ポイント", exact: true, level: 2 })).toBeVisible();

  await openView(page, "pricing");
  await expect(page.getByRole("heading", { name: "無料版とPro版の比較" })).toBeVisible();
  await expect(page.getByTestId("access-summary")).toContainText("課金なし・プレビュー");

  if (testInfo.project.name === "mobile") {
    const bottomNav = page.getByTestId("mobile-bottom-nav");
    await expect(bottomNav).toBeVisible();
    await expect(bottomNav.locator("button")).toHaveCount(5);
    await expect(bottomNav.locator('[data-mobile-nav="menu"]')).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("pricing-comparison-mobile")).toBeVisible();
    await expect(page.getByTestId("pricing-comparison-mobile")).toContainText("ブラウザ内保存・JSONバックアップ");
    await expect(page.getByTestId("pricing-comparison-mobile")).toContainText("本人・配偶者・子ども・親ごとの予定整理");
    await expect(page.getByTestId("pricing-comparison-mobile")).toContainText("1000回のばらつき試算・老後設計");
    const comparisonOverflow = await page.getByTestId("pricing-comparison-mobile").evaluate(
      (element) => element.scrollWidth - element.clientWidth
    );
    expect(comparisonOverflow).toBeLessThanOrEqual(1);
  } else {
    await expect(page.getByRole("cell", { name: "ブラウザ内保存・JSONバックアップ", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "本人・配偶者・子ども・親ごとの予定整理", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "1000回のばらつき試算・老後設計", exact: true })).toBeVisible();
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Pro機能を確認する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "見直しプラン", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "現状維持", exact: true }).click();
  await expect(page.locator(".scenario-row")).toHaveCount(1);
  await page.getByRole("button", { name: "比較結果", exact: true }).click();
  await expect(page.getByRole("cell", { name: "10年後資産", exact: true })).toBeVisible();
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-mode", "preview");
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-tier", "free");
});

test("無料版でも一定利回りの積立・取り崩し試算を利用できる", async ({ page }) => {
  await page.route("**/api/entitlement", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ access: { tier: "free", mode: "enforced", source: "anonymous" } })
    });
  });
  await page.route("**/api/backups", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true, backups: [], limit: 5 })
    });
  });
  await page.reload();

  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-mode", "enforced");
  await openView(page, "household");
  const storedMonthlyIncome = page.getByRole("textbox", { name: "月収", exact: true });
  await storedMonthlyIncome.fill("320001");
  await storedMonthlyIncome.blur();
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem("life-compass-plan-v1")))).toBe(true);
  const expiredProPlan = await page.evaluate(() => JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}"));
  const currentYear = new Date().getFullYear();
  expiredProPlan.cashflowMode = "detailed";
  expiredProPlan.detailedCashflowItems = [{
      id: "expired-pro-cashflow",
      title: "保持される月収",
      memberId: expiredProPlan.householdMembers?.[0]?.id ?? null,
      target: "monthlyIncome",
      startYear: currentYear,
      endYear: currentYear + 1,
      amount: 320000,
      memo: ""
  }];
  await page.addInitScript((plan) => {
    localStorage.setItem("life-compass-plan-v1", JSON.stringify(plan));
  }, expiredProPlan);
  await page.reload();
  await openView(page, "household");
  await expect(page.getByRole("button", { name: "家族ごとに入力", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "世帯全体で入力", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "月収", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "世帯全体で入力", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "月収", exact: true })).toBeEnabled();
  const retainedDetailedCashflow = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    return { mode: plan.cashflowMode, count: plan.detailedCashflowItems?.length ?? 0 };
  });
  expect(retainedDetailedCashflow).toEqual({ mode: "basic", count: 1 });

  await openView(page, "simulation");
  await page.getByRole("button", { name: "積立試算" }).click();
  await expect(page.getByRole("heading", { name: "積立シミュレーション" })).toBeVisible();
  await expect(page.getByText("利回りのばらつき試算はPro版", { exact: true })).toBeVisible();
  await expect(page.getByLabel("年ごとの利回りのばらつき目安 %")).toHaveCount(0);

  await page.getByRole("button", { name: "取り崩し試算" }).click();
  await expect(page.getByLabel("試算開始時資金")).toBeVisible();
  await expect(page.getByText("資産が尽きるケース割合とばらつき試算はPro版", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "105歳", exact: true })).toHaveCount(0);
  await page.getByText("年次の試算表を確認").click();
  await expect(page.getByRole("cell", { name: "105歳", exact: true })).toBeVisible();

  await openView(page, "retirement");
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByTestId("access-summary")).toContainText("無料版");
  await expect(page.getByRole("button", { name: "Pro版は準備中", exact: true })).toBeDisabled();

  await openView(page, "data");
  await expect(page.getByText("新しいクラウドバックアップの保存はPro版", { exact: true })).toBeVisible();
  await expect(page.getByLabel("保存用の復旧パスワード")).toHaveCount(0);
});

test("運営者としてログインした場合だけ課金なしでPro機能を確認できる", async ({ page }) => {
  await page.route("**/api/entitlement", (route) => route.fulfill({
    json: { access: { tier: "pro", mode: "enforced", source: "operator" } }
  }));
  await page.reload();

  await openView(page, "pricing");
  await expect(page.getByTestId("access-summary")).toContainText("運営者テスト");
  await expect(page.getByText("一般利用者には無料版の機能境界が適用されます。", { exact: false })).toBeVisible();
  const openPro = page.getByRole("button", { name: "Pro機能を確認する", exact: true });
  await expect(openPro).toBeEnabled();
  await openPro.click();
  await expect(page.getByRole("heading", { name: "見直しプラン", level: 1 })).toBeVisible();
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-tier", "pro");
});

test("シナリオ前提を編集して基本プランへ採用し、採用前の条件を残せる", async ({ page }) => {
  await openView(page, "scenarios");
  await page.getByRole("button", { name: "支出見直し", exact: true }).click();
  const originalFixedCost = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    return plan.household.fixedCost as number;
  });

  await page.getByLabel("編集するプラン").selectOption({ label: "支出見直し" });
  const scenarioFixedCost = page.getByLabel("見直しプランの固定費 月額");
  await scenarioFixedCost.fill("88888");
  await scenarioFixedCost.blur();

  const beforeAdoption = await page.evaluate(() => JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}"));
  expect(beforeAdoption.household.fixedCost).toBe(originalFixedCost);
  expect(beforeAdoption.scenarios[0].snapshot.household.fixedCost).toBe(88888);

  await page.getByRole("button", { name: "比較結果", exact: true }).click();
  const impactAnalysis = page.getByTestId("scenario-impact-analysis");
  await expect(impactAnalysis).toBeVisible();
  await expect(impactAnalysis).toContainText("順位付けや助言ではなく");
  await expect(impactAnalysis).toContainText("固定費 月額");
  await expect(impactAnalysis).toContainText("年間収支への直接差");
  await expect(impactAnalysis).toContainText("10年後資産");
  const impactOverflow = await impactAnalysis.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(impactOverflow).toBeLessThanOrEqual(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "このプランを採用", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("基本プランへ採用しました");

  const afterAdoption = await page.evaluate(() => JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}"));
  expect(afterAdoption.household.fixedCost).toBe(88888);
  expect(afterAdoption.activeScenario.name).toBe("支出見直し");
  expect(afterAdoption.scenarios.some((scenario: { name: string }) => scenario.name === "支出見直し")).toBe(false);
  const previousPlan = afterAdoption.scenarios.find((scenario: { name: string }) => scenario.name.startsWith("採用前:"));
  expect(previousPlan.snapshot.household.fixedCost).toBe(originalFixedCost);

  await page.reload();
  const persistedPlan = await page.evaluate(() => JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}"));
  expect(persistedPlan.household.fixedCost).toBe(88888);
  expect(persistedPlan.scenarios.some((scenario: { name: string }) => scenario.name.startsWith("採用前:"))).toBe(true);

  await openView(page, "dashboard");
  await expect(page.getByRole("heading", { name: "計画を見直すタイミング", level: 2 })).toBeVisible();
  await expect(page.getByText("支出見直し", { exact: true }).first()).toBeVisible();
});

test("シナリオ内の時期別収支・目標・イベントを編集して採用できる", async ({ page }) => {
  await openView(page, "scenarios");
  await page.getByRole("button", { name: "現状維持", exact: true }).click();
  const initialCounts = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    return {
      cashflowPeriods: plan.cashflowPeriods.length,
      goals: plan.goals.length,
      events: plan.events.length,
      scenarioCashflowPeriods: plan.scenarios[0].snapshot.cashflowPeriods.length,
      scenarioGoals: plan.scenarios[0].snapshot.goals.length,
      scenarioEvents: plan.scenarios[0].snapshot.events.length
    };
  });

  await page.getByLabel("編集するプラン").selectOption({ label: "現状維持" });

  const scenarioTabs = page.locator(".scenario-editor-tabs");
  await scenarioTabs.getByRole("button", { name: /時期別収支/ }).click();
  const cashflowForm = page.getByTestId("scenario-cashflow-create-form");
  await cashflowForm.getByLabel("変更名").fill("育休期間の収入");
  await cashflowForm.getByLabel("期間中の金額（月額）").fill("210000");
  await cashflowForm.getByRole("button", { name: "時期別収支を登録" }).click();
  await expect(cashflowForm.getByRole("status")).toContainText("見直しプランへ登録しました");

  await scenarioTabs.getByRole("button", { name: /目標/ }).click();
  const goalForm = page.getByTestId("scenario-goal-create-form");
  await goalForm.getByLabel("目標名").fill("住宅購入の頭金");
  await goalForm.getByLabel("目標額").fill("5000000");
  await goalForm.getByRole("button", { name: "目標を登録" }).click();
  await expect(goalForm.getByRole("status")).toContainText("見直しプランへ登録しました");

  await scenarioTabs.getByRole("button", { name: /イベント/ }).click();
  const eventForm = page.getByTestId("scenario-event-create-form");
  await eventForm.getByLabel("イベント名").fill("住宅購入");
  await eventForm.getByLabel("家計への影響").selectOption("expense");
  await eventForm.getByLabel("金額").fill("3000000");
  await eventForm.getByRole("button", { name: "イベントを登録" }).click();
  await expect(eventForm.getByRole("status")).toContainText("見直しプランへ登録しました");

  const beforeAdoption = await page.evaluate(() => JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}"));
  expect(beforeAdoption.cashflowPeriods).toHaveLength(initialCounts.cashflowPeriods);
  expect(beforeAdoption.goals).toHaveLength(initialCounts.goals);
  expect(beforeAdoption.events).toHaveLength(initialCounts.events);
  expect(beforeAdoption.scenarios[0].snapshot.cashflowPeriods).toHaveLength(initialCounts.scenarioCashflowPeriods + 1);
  expect(beforeAdoption.scenarios[0].snapshot.goals).toHaveLength(initialCounts.scenarioGoals + 1);
  expect(beforeAdoption.scenarios[0].snapshot.events).toHaveLength(initialCounts.scenarioEvents + 1);

  await page.getByRole("button", { name: "比較結果", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "このプランを採用", exact: true }).click();
  const adopted = await page.evaluate(() => JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}"));
  expect(adopted.cashflowPeriods.some((period: { title: string }) => period.title === "育休期間の収入")).toBe(true);
  expect(adopted.goals.some((goal: { title: string }) => goal.title === "住宅購入の頭金")).toBe(true);
  expect(adopted.events.some((item: { title: string }) => item.title === "住宅購入")).toBe(true);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("診断の見直し候補から支出見直しの比較案を作成して保存できる", async ({ page }) => {
  await openView(page, "household");
  const fixedCostInput = page.getByLabel("固定費");
  await fixedCostInput.fill("900000");
  await fixedCostInput.blur();

  await openView(page, "diagnosis");
  await expect(page.getByRole("heading", { name: "今回の見直し候補", level: 3 })).toBeVisible();
  await expect(page.getByText("通常月の収支がマイナスの前提です", { exact: true })).toBeVisible();
  await expect(page.locator(".diagnosis-confirmed")).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "支出見直しの比較案を作る", exact: true }).click();

  await expect(page.getByRole("heading", { name: "見直しプラン", level: 1 })).toBeVisible();
  await expect(page.locator(".scenario-row").getByLabel("見直しプラン名")).toHaveValue("支出見直し");
  await page.reload();
  await openView(page, "scenarios");
  await expect(page.locator(".scenario-row").getByLabel("見直しプラン名")).toHaveValue("支出見直し");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Proレビューで将来見通しを保存し、見直しシナリオへつなげられる", async ({ page }) => {
  await openView(page, "reviews");
  await expect(page.getByRole("heading", { name: "計画と実績の差を、次の見直しへつなげる", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "今月のレビューを作成", exact: true }).click();

  await expect(page.locator(".review-record")).toHaveCount(1);
  await expect(page.getByText("基準: 基本プラン", { exact: true })).toBeVisible();
  await expect(page.getByText("10年後見通し", { exact: true })).toBeVisible();
  await expect(page.getByText("30年後見通し", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "計画の版履歴", level: 2 })).toBeVisible();
  await expect(page.locator(".plan-revision-item")).toHaveCount(1);
  await expect(page.locator(".plan-revision-item").first()).toContainText("レビュー作成時");
  const reviewOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(reviewOverflow).toBeLessThanOrEqual(1);
  await page.getByLabel("実際の純資産").fill("3456789");
  await page.getByLabel("実際の純資産").blur();
  await page.getByLabel("実際の支出（月合計）").fill("270000");
  await page.getByLabel("実際の支出（月合計）").blur();

  const savedReview = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    return plan.reviews[0];
  });
  expect(savedReview.actualNetAssets).toBe(3456789);
  expect(savedReview.actualMonthlyExpenses).toBe(270000);
  expect(savedReview.plannedTenYearAssets).toEqual(expect.any(Number));
  expect(savedReview.plannedThirtyYearAssets).toEqual(expect.any(Number));

  await page.getByRole("button", { name: "最新レビューから見直し案を作る", exact: true }).click();
  await expect(page.getByRole("heading", { name: "実績を反映する項目", level: 3 })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "実際の純資産を反映", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "実際の月間支出を反映", exact: true })).toBeChecked();
  const builderOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(builderOverflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "この内容で見直し案を作る", exact: true }).click();
  await expect(page.getByRole("heading", { name: "見直しプラン", level: 1 })).toBeVisible();
  const expectedScenarioName = `${new Date().toISOString().slice(0, 7).replace("-", "年")}月 見直し案`;
  await expect(page.locator(".scenario-row").getByLabel("見直しプラン名")).toHaveValue(expectedScenarioName);
  const reflectedScenario = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}");
    const scenario = plan.scenarios[0];
    return {
      netAssets: scenario.snapshot.assets.cash + scenario.snapshot.assets.investment + scenario.snapshot.assets.other - scenario.snapshot.assets.debt,
      monthlyExpenses: scenario.snapshot.household.fixedCost + scenario.snapshot.household.variableCost + scenario.snapshot.household.annualSpecialCost / 12
    };
  });
  expect(reflectedScenario.netAssets).toBe(3456789);
  expect(reflectedScenario.monthlyExpenses).toBe(270000);

  await page.reload();
  await openView(page, "dashboard");
  await expect(page.getByRole("heading", { name: "計画を見直すタイミング", level: 2 })).toBeVisible();
  await expect(page.getByText("今月確認済み", { exact: true })).toBeVisible();
});

test("計画を版として保存し、レビューと比較案を残したまま復元できる", async ({ page }) => {
  await openView(page, "reviews");
  await page.getByRole("button", { name: "現在の計画を版として保存", exact: true }).click();
  await expect(page.locator(".plan-revision-item")).toHaveCount(1);

  await openView(page, "household");
  const incomeInput = page.getByLabel("月収");
  await incomeInput.fill("555000");
  await incomeInput.blur();
  await expect(incomeInput).toHaveValue("555,000");

  await openView(page, "reviews");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "この版へ戻す", exact: true }).click();
  await expect(page.locator(".plan-revision-section [role='status']")).toContainText("戻しました");
  await expect(page.locator(".plan-revision-item")).toHaveCount(2);
  await expect(page.locator(".plan-revision-item").first()).toContainText("復元前");

  await openView(page, "household");
  await expect(page.getByLabel("月収")).toHaveValue("320,000");
  await page.reload();
  await openView(page, "household");
  await expect(page.getByLabel("月収")).toHaveValue("320,000");

  const savedPlan = await page.evaluate(() => JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}"));
  expect(savedPlan.planRevisions).toHaveLength(2);
  expect(savedPlan.planRevisions[0].source).toBe("beforeRestore");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("基本見通しで家計余剰の振り分けを設定して保存できる", async ({ page }) => {
  await openView(page, "simulation");
  const allocation = page.locator(".projection-allocation");

  await expect(allocation).toContainText("家計余剰の振り分け");
  await expect(page.getByText("6〜6ヶ月分", { exact: true })).toHaveCount(0);
  await expect(page.getByText("6ヶ月分", { exact: true }).first()).toBeVisible();

  const monthlyInvestment = page.getByLabel("毎月、投資へ回す額");
  await monthlyInvestment.fill("999999");
  await expect(allocation).toContainText("入力額を試算可能な範囲に調整しています");

  await monthlyInvestment.fill("40000");
  await monthlyInvestment.blur();
  const bonusInvestment = page.getByLabel("ボーナスから投資へ回す年額");
  await bonusInvestment.fill("200000");
  await bonusInvestment.blur();
  await expect(allocation).toContainText("40,000");
  await expect(allocation).toContainText("35,000");
  await expect(page.getByText(/税金・手数料・物価上昇は含めません/)).toBeVisible();

  await page.reload();
  await openView(page, "simulation");
  await expect(page.getByLabel("毎月、投資へ回す額")).toHaveValue("40,000");
  await expect(page.getByLabel("ボーナスから投資へ回す年額")).toHaveValue("200,000");
});

test("時期別の収支を年次見通しへ反映して保存できる", async ({ page }) => {
  const periodYear = new Date().getFullYear() + 1;

  await openView(page, "profile");
  const memberForm = page.getByTestId("household-member-create-form");
  await memberForm.getByLabel("呼び名").fill("子どもA");
  await memberForm.getByLabel("続柄").selectOption("child");
  await memberForm.getByLabel("生まれた年").fill(String(new Date().getFullYear() - 10));
  await memberForm.getByLabel("生まれた月").selectOption(String(new Date().getMonth() + 1));
  await memberForm.getByRole("button", { name: "メンバーを追加", exact: true }).click();

  await openView(page, "household");
  await page.getByRole("button", { name: "期間を追加", exact: true }).click();

  const periodRow = page.locator(".cashflow-period-row");
  await periodRow.getByLabel("変更名").fill("育休中の収入");
  await periodRow.getByLabel("期間中の金額（月額）").fill("200000");
  await periodRow.getByLabel("期間中の金額（月額）").blur();
  await expect(periodRow.getByText(`${periodYear}年`)).toBeVisible();

  await openView(page, "simulation");
  await page.getByRole("button", { name: "年次収支", exact: true }).click();
  await expect(page.getByRole("heading", { name: "年次キャッシュフロー", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${periodYear}年 収入`) }).click();
  const cashflowDetails = page.locator(".annual-cashflow-chart .chart-selection-panel");
  await expect(cashflowDetails).toContainText(`${periodYear}年`);
  await expect(cashflowDetails).toContainText("年間収入");
  await expect(cashflowDetails).toContainText("年間支出");
  await expect(cashflowDetails).toContainText("年間収支");

  await page.getByText("世帯年齢と年次キャッシュフローの内訳を確認").click();
  const ledgerRow = page.locator(".annual-ledger-row").filter({ hasText: `${periodYear}年時点` }).first();
  await expect(ledgerRow.locator(".annual-ledger-summary")).toHaveAttribute("aria-expanded", "true");
  await expect(ledgerRow).toContainText("子どもA（子ども） 11歳");
  await expect(ledgerRow).toContainText("収入の内訳");
  await expect(ledgerRow).toContainText("支出の内訳");
  await expect(ledgerRow).toContainText("残高の内訳");
  await expect(ledgerRow).toContainText("育休中の収入");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "見直しプランで検討（Pro）", exact: true }).click();
  await expect(page.getByRole("heading", { name: "見直しプラン", level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(`${periodYear}年の年次収支から開きました`);

  await page.reload();
  await openView(page, "household");
  await expect(page.locator(".cashflow-period-row").getByLabel("変更名")).toHaveValue("育休中の収入");
  await expect(page.locator(".cashflow-period-row").getByLabel("期間中の金額（月額）")).toHaveValue("200,000");
});

test("詳細シミュレーションのグラフを操作して試算値を確認できる", async ({ page }) => {
  await openView(page, "simulation");
  await page.getByRole("button", { name: "積立試算" }).click();

  const contributionPoint = page.getByRole("button", { name: /15年目 中央値/ });
  await contributionPoint.click();
  const contributionDetails = page.locator(".chart-selection-panel");
  await expect(contributionDetails).toContainText("15年目 / 中央値");
  await expect(contributionDetails).toContainText("下位10%");
  await expect(contributionDetails).toContainText("最頻帯");
  await expect(contributionDetails).toContainText("上位10%");

  await page.getByRole("button", { name: "取り崩し試算" }).click();
  await expect(page.getByRole("button", { name: /65歳 中央値/ })).toBeVisible();
  await page.getByRole("button", { name: /72歳 中央値/ }).click();
  const withdrawalDetails = page.locator(".chart-selection-panel");
  await expect(withdrawalDetails).toContainText("72歳 / 中央値");
  await expect(withdrawalDetails).toContainText("取り崩し額");

  await page.getByText("年次の試算表を確認").click();
  const withdrawalTable = page.locator(".projection-detail-table");
  await expect(withdrawalTable.getByRole("columnheader", { name: "年末年齢" })).toBeVisible();
  await expect(withdrawalTable.getByRole("cell", { name: "66歳", exact: true })).toBeVisible();
  await expect(withdrawalTable.getByRole("cell", { name: "100歳", exact: true })).toBeVisible();
  await expect(withdrawalTable.getByRole("cell", { name: "105歳", exact: true })).toBeVisible();

  const ageLabels = await page.locator(".year-label").allTextContents();
  expect(ageLabels).toContain("72歳");
  expect(ageLabels).not.toContain("70歳");
  expect(ageLabels).not.toContain("75歳");
});

test("法務・料金ページをURLから直接開ける", async ({ page }) => {
  const pages = [
    ["/terms", "利用規約"],
    ["/privacy", "プライバシーポリシー"],
    ["/commercial-disclosure", "特定商取引法に基づく表記"],
    ["/refund", "解約・返金方針"],
    ["/pricing", "Pro・料金"],
    ["/contact", "お問い合わせ"],
    ["/disclaimer", "免責事項"]
  ] as const;

  for (const [path, title] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path.replace("/", "\\/")}$`));
  }
});

test("設定画面でログインが任意でありログインだけではクラウド保存を開始しないと確認できる", async ({ page }) => {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const accountPanel = page.getByTestId("account-panel");
  await expect(accountPanel).toBeVisible();
  await expect(page.getByTestId("household-sharing-panel")).toHaveCount(0);
  await expect(accountPanel).toContainText("無料版はログインなしで利用できます");
  await expect(accountPanel).toContainText("ログインしただけでは自動でクラウド保存しません");
  await expect(accountPanel).toContainText("Googleログインは設定中です");
  await page.getByRole("button", { name: "表示・通知", exact: true }).click();
  await page.getByRole("button", { name: /^ダーク/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("設定を用途別に切り替え、PWAとバックアップの案内を確認できる", async ({ page }) => {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const settingsNavigation = page.getByRole("navigation", { name: "設定項目" });
  await expect(settingsNavigation.getByRole("button", { name: "アカウント・共同世帯", exact: true })).toHaveAttribute("aria-pressed", "true");

  await settingsNavigation.getByRole("button", { name: "バックアップ・復元", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Life Compassをアプリとして追加", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "バックアップ・復元を開く", exact: true })).toBeVisible();

  await settingsNavigation.getByRole("button", { name: "使い方", exact: true }).click();
  await expect(page.getByRole("heading", { name: "基本的な使い方", exact: true })).toBeVisible();

  const manifestResponse = await page.request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json() as {
    display?: string;
    icons?: Array<{ sizes?: string; type?: string }>;
  };
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons).toEqual(expect.arrayContaining([
    expect.objectContaining({ sizes: "192x192", type: "image/png" }),
    expect.objectContaining({ sizes: "512x512", type: "image/png" })
  ]));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("招待メールは自動送信されず、招待リンクを相手へ送る手順を案内できる", async ({ page }) => {
  const householdId = "8aef8bc1-51c6-4241-96c1-edf289c35362";
  const inviteUrl = `https://life.raotomo.com/#/household-invite/${"a".repeat(48)}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { copiedInviteForTest?: string }).copiedInviteForTest = text;
        }
      }
    });
  });
  await page.route("**/api/auth/config", (route) => route.fulfill({
    json: { configured: true, clientId: "test-client-id" }
  }));
  await page.route("**/api/me", (route) => route.fulfill({
    json: {
      authenticated: true,
      user: { id: "owner-user", email: "owner@example.com", emailVerified: true }
    }
  }));
  await page.route("**/api/entitlement", (route) => route.fulfill({
    json: { access: { tier: "pro", mode: "enforced", source: "operator" } }
  }));
  await page.route("**/api/shared-household/invitations", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ email: "editor@example.com" });
    await route.fulfill({
      status: 201,
      json: {
        invitation: {
          id: "invite-1",
          inviteUrl,
          expiresAt
        }
      }
    });
  });
  await page.route("**/api/shared-household", (route) => route.fulfill({
    json: {
      mode: "preview",
      canCreate: false,
      household: {
        id: householdId,
        role: "owner",
        status: "active",
        keyEpoch: 1,
        currentRevision: 0,
        memberCount: 1,
        members: [{
          id: "owner-membership",
          role: "owner",
          email: "owner@example.com",
          isCurrentUser: true,
          joinedAt: new Date().toISOString()
        }],
        pendingInvitations: [],
        readAllowed: true,
        writeAllowed: true,
        ownerProActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
  }));

  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const sharingPanel = page.getByTestId("household-sharing-panel");
  await expect(sharingPanel).toBeVisible();
  await expect(sharingPanel.getByText("招待メールは自動送信されません", { exact: true })).toBeVisible();
  await expect(sharingPanel).toContainText("コピーしてLINEやメールなどで共有したい相手へ送ってください");

  await sharingPanel.getByLabel("招待するGoogleアカウントのメール").fill("editor@example.com");
  await sharingPanel.getByRole("button", { name: "招待リンクを作成", exact: true }).click();
  await expect(sharingPanel.getByText(
    "招待リンクを作成しました。メールは自動送信されません。リンクをコピーして相手へ送ってください。",
    { exact: true }
  )).toBeVisible();
  await expect(sharingPanel.getByText("招待リンクを共有したい相手へ送ってください", { exact: true })).toBeVisible();
  await expect(sharingPanel).toContainText("LINEやメールなどのメッセージに貼り付けて送信します");
  await expect(sharingPanel).toContainText("この画面を閉じる前にコピーしてください");
  await expect(sharingPanel).toContainText("共有パスワードは招待リンクとは別の方法で伝えます");

  await sharingPanel.getByRole("button", { name: "招待リンクをコピー", exact: true }).click();
  await expect(sharingPanel.getByText(
    "招待リンクをコピーしました。共有したい相手とのメッセージ画面に貼り付けて送信してください。",
    { exact: true }
  )).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => (window as Window & { copiedInviteForTest?: string }).copiedInviteForTest
  )).toBe(inviteUrl);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Freeの共同利用者は自動同期中の世帯プランだけPro編集できる", async ({ page }) => {
  test.setTimeout(90_000);
  const householdId = "7f3c6fa0-21b5-4f8d-bbf5-32208c557619";
  const sharedPassword = "household-test-password";
  const plaintextMarker = "共有平文を送らない確認プラン";
  let currentRevision = 0;
  let savedRequestBody = "";
  let savedEnvelope: Record<string, unknown> | null = null;
  let savedAt = new Date().toISOString();

  await page.route("**/api/auth/config", (route) => route.fulfill({
    json: { configured: true, clientId: "test-client-id" }
  }));
  await page.route("**/api/me", (route) => route.fulfill({
    json: {
      authenticated: true,
      user: { id: "editor-user", email: "editor@example.com", emailVerified: true }
    }
  }));
  await page.route("**/api/entitlement", (route) => route.fulfill({
    json: {
      access: {
        tier: "free",
        mode: "enforced",
        source: "anonymous",
        household: {
          householdId,
          effectiveTier: "pro",
          writeAllowed: true
        }
      }
    }
  }));
  await page.route("**/api/backups", (route) => route.fulfill({
    json: { available: true, backups: [], limit: 5 }
  }));
  await page.route("**/api/shared-household/revisions", (route) => route.fulfill({
    json: {
      currentRevision,
      revisions: currentRevision > 0
        ? [{
            revision: currentRevision,
            keyEpoch: 1,
            planVersion: 9,
            sizeBytes: 1024,
            createdAt: new Date().toISOString()
          }]
        : [],
      limit: 10
    }
  }));
  await page.route("**/api/shared-household/plan", async (route) => {
    if (route.request().method() === "GET") {
      if (!savedEnvelope || currentRevision === 0) {
        await route.fulfill({ status: 404, json: { error: { code: "shared_plan_object_not_found" } } });
        return;
      }
      await route.fulfill({
        json: {
          householdId,
          currentRevision,
          keyEpoch: 1,
          revision: {
            revision: currentRevision,
            keyEpoch: 1,
            planVersion: 9,
            sizeBytes: savedRequestBody.length,
            createdAt: savedAt
          },
          envelope: savedEnvelope
        }
      });
      return;
    }
    savedRequestBody = route.request().postData() || "";
    const parsed = JSON.parse(savedRequestBody) as {
      expectedRevision?: number;
      envelope?: Record<string, unknown>;
    };
    if (parsed.expectedRevision !== currentRevision) {
      await route.fulfill({ status: 409, json: { error: { code: "shared_plan_conflict" } } });
      return;
    }
    currentRevision += 1;
    savedEnvelope = parsed.envelope || null;
    savedAt = new Date().toISOString();
    await route.fulfill({
      status: 201,
      json: {
        currentRevision,
        keyEpoch: 1,
        revision: {
          revision: currentRevision,
          keyEpoch: 1,
          planVersion: 9,
          sizeBytes: savedRequestBody.length,
          createdAt: savedAt
        }
      }
    });
  });
  await page.route("**/api/shared-household", (route) => route.fulfill({
    json: {
      mode: "preview",
      canCreate: false,
      household: {
        id: householdId,
        role: "editor",
        status: "active",
        keyEpoch: 1,
        currentRevision,
        memberCount: 1,
        members: [{
          id: "editor-membership",
          role: "editor",
          email: "editor@example.com",
          isCurrentUser: true,
          joinedAt: new Date().toISOString()
        }],
        pendingInvitations: [],
        readAllowed: true,
        writeAllowed: true,
        ownerProActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
  }));

  await page.reload();
  await openView(page, "household");
  await expect(page.getByRole("button", { name: "家族ごとに入力", exact: true })).toHaveCount(0);
  await openView(page, "profile");
  await page.getByLabel("プラン名").fill(plaintextMarker);
  await page.getByRole("button", { name: "設定", exact: true }).click();

  const sharingPanel = page.getByTestId("household-sharing-panel");
  await expect(sharingPanel).toBeVisible();
  await expect(sharingPanel).toContainText("一般利用者向けにはまだ有効化していません");
  await sharingPanel.getByLabel("現在の共有パスワード").fill(sharedPassword);
  page.once("dialog", (dialog) => dialog.accept());
  await sharingPanel.getByRole("button", { name: "この端末で自動同期を始める", exact: true }).click();
  await expect.poll(() => currentRevision, { timeout: 15_000 }).toBe(1);
  await expect(sharingPanel).toContainText("同期済み");
  await expect(sharingPanel.getByLabel("現在の共有パスワード")).toHaveValue("");
  await expect(sharingPanel.getByRole("button", { name: "今すぐ同期", exact: true })).toBeVisible();

  await openView(page, "household");
  await expect(page.getByRole("button", { name: "家族ごとに入力", exact: true })).toBeEnabled();
  await openView(page, "data");
  await expect(page.getByText("新しいクラウドバックアップの保存はPro版", { exact: true })).toBeVisible();
  await expect(page.getByLabel("保存用の復旧パスワード")).toHaveCount(0);

  await expect.poll(() => savedRequestBody.length).toBeGreaterThan(0);
  const savedBody = JSON.parse(savedRequestBody) as {
    envelope?: { ciphertext?: string; householdId?: string; revision?: number; keyEpoch?: number };
  };
  expect(savedBody.envelope?.householdId).toBe(householdId);
  expect(savedBody.envelope?.revision).toBe(1);
  expect(savedBody.envelope?.keyEpoch).toBe(1);
  expect(savedBody.envelope?.ciphertext?.length).toBeGreaterThan(100);
  expect(savedRequestBody).not.toContain(plaintextMarker);
  expect(savedRequestBody).not.toContain(sharedPassword);

  const browserStorage = await page.evaluate(() => ({
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage)
  }));
  expect(browserStorage.local).not.toContain(sharedPassword);
  expect(browserStorage.session).not.toContain(sharedPassword);
  const trustedDeviceRecord = await page.evaluate(async () => {
    const request = indexedDB.open("life-compass-secure-device");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("shared-plan-credentials", "readonly");
    const getRequest = transaction.objectStore("shared-plan-credentials").getAll();
    const records = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      getRequest.onsuccess = () => resolve(getRequest.result);
      getRequest.onerror = () => reject(getRequest.error);
    });
    database.close();
    const record = records[0] as { deviceKey?: CryptoKey; encryptedCredential?: ArrayBuffer } | undefined;
    return {
      count: records.length,
      hasPlainPasswordProperty: Boolean(record && "password" in record),
      hasPlainDigestProperty: Boolean(record && "lastPlanDigest" in record),
      keyExtractable: record?.deviceKey?.extractable,
      encryptedLength: record?.encryptedCredential?.byteLength || 0
    };
  });
  expect(trustedDeviceRecord.count).toBe(1);
  expect(trustedDeviceRecord.hasPlainPasswordProperty).toBe(false);
  expect(trustedDeviceRecord.hasPlainDigestProperty).toBe(false);
  expect(trustedDeviceRecord.keyExtractable).toBe(false);
  expect(trustedDeviceRecord.encryptedLength).toBeGreaterThan(sharedPassword.length + 16);

  const autoSavedMarker = "自動同期で保存する確認プラン";
  await openView(page, "profile");
  await page.getByLabel("プラン名").fill(autoSavedMarker);
  await expect.poll(() => currentRevision, { timeout: 35_000 }).toBe(2);
  expect(savedRequestBody).not.toContain(autoSavedMarker);
  expect(savedRequestBody).not.toContain(sharedPassword);

  const remotePlan = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("life-compass-plan-v1") || "{}") as LifePlan
  );
  remotePlan.profile.name = "共同利用者が更新したプラン";
  remotePlan.updatedAt = new Date().toISOString();
  currentRevision = 3;
  savedEnvelope = await encryptSharedPlan(remotePlan, sharedPassword, {
    householdId,
    revision: currentRevision,
    keyEpoch: 1
  });
  savedAt = new Date().toISOString();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByLabel("プラン名")).toHaveValue("共同利用者が更新したプラン", { timeout: 15_000 });

  await page.getByLabel("プラン名").fill("この端末で編集中のプラン");
  const conflictingRemotePlan = structuredClone(remotePlan);
  conflictingRemotePlan.profile.name = "共同世帯側の競合プラン";
  conflictingRemotePlan.updatedAt = new Date().toISOString();
  currentRevision = 4;
  savedEnvelope = await encryptSharedPlan(conflictingRemotePlan, sharedPassword, {
    householdId,
    revision: currentRevision,
    keyEpoch: 1
  });
  savedAt = new Date().toISOString();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const conflictPanel = page.getByTestId("household-sharing-panel");
  await expect(conflictPanel).toContainText("両方に未反映の変更があります", { timeout: 15_000 });
  await conflictPanel.getByRole("button", { name: "共同世帯の内容を使う", exact: true }).click();
  await openView(page, "profile");
  await expect(page.getByLabel("プラン名")).toHaveValue("共同世帯側の競合プラン");

  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const reloadedSharingPanel = page.getByTestId("household-sharing-panel");
  await expect(reloadedSharingPanel).toContainText("同期済み");
  await expect(reloadedSharingPanel.getByRole("button", { name: "今すぐ同期", exact: true })).toBeVisible();

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("ログアウトとアカウント削除後にGoogleログインボタンを再表示できる", async ({ page }) => {
  await page.route("**/api/auth/config", (route) => route.fulfill({ json: { configured: true, clientId: "test-client-id" } }));
  await page.route("**/api/me", (route) => route.fulfill({ json: { authenticated: true, user: { id: "user-1", email: "test@example.com", emailVerified: true } } }));
  await page.route("**/api/entitlement", (route) => route.fulfill({ json: { access: { tier: "free", mode: "preview", source: "local-preview" } } }));
  await page.route("**/api/auth/logout", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/account", (route) => route.fulfill({ json: { ok: true, accountDeleted: true } }));
  await page.route("**/api/auth/nonce", (route) => route.fulfill({ json: { nonce: "test-nonce" } }));
  await page.addInitScript(() => {
    window.google = {
      accounts: {
        id: {
          initialize: () => undefined,
          renderButton: (element: HTMLElement) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = "Googleで再ログイン";
            element.appendChild(button);
          },
          disableAutoSelect: () => undefined
        }
      }
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).click();

  await expect(page.getByTestId("account-logout")).toBeVisible();
  await expect(page.getByTestId("account-logout-all")).toBeVisible();
  await page.getByTestId("account-logout").click();
  await expect(page.getByTestId("google-sign-in-slot").getByRole("button", { name: "Googleで再ログイン" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const planBeforeDeletion = await page.evaluate(() => localStorage.getItem("life-compass-plan-v1"));
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("account-delete").click();
  await expect(page.getByText("アカウント情報を削除しました。ブラウザ内のライフプランデータは残っています。")).toBeVisible();
  await expect(page.getByTestId("google-sign-in-slot").getByRole("button", { name: "Googleで再ログイン" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("life-compass-plan-v1"))).toBe(planBeforeDeletion);
});

test("暗号化クラウドバックアップを手動保存・復元・削除できる", async ({ page }) => {
  let savedEnvelope: unknown = null;
  let backupExists = false;
  const backup = {
    id: "11111111-1111-4111-8111-111111111111",
    planVersion: 3,
    sizeBytes: 2048,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await page.route("**/api/backups**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/backups") {
      await route.fulfill({ json: { ok: true, available: true, backups: backupExists ? [backup] : [], limit: 5 } });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/api/backups") {
      const body = request.postDataJSON() as { envelope?: unknown };
      savedEnvelope = body.envelope;
      backupExists = true;
      await route.fulfill({ status: 201, json: { ok: true, available: true, backup } });
      return;
    }
    if (request.method() === "GET" && url.pathname === `/api/backups/${backup.id}`) {
      await route.fulfill({ json: { ok: true, envelope: savedEnvelope } });
      return;
    }
    if (request.method() === "DELETE" && url.pathname === `/api/backups/${backup.id}`) {
      backupExists = false;
      await route.fulfill({ json: { ok: true, deleted: true, id: backup.id } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: "not_found" } } });
  });

  await openView(page, "profile");
  await page.getByLabel("プラン名").fill("クラウド保存前プラン");
  await openView(page, "data");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText("現在のプランを、ここで設定する復旧パスワードで暗号化して保存します。")).toBeVisible();
  await page.getByLabel("保存用の復旧パスワード", { exact: true }).fill("e2e secure recovery password");
  await page.getByLabel("保存用の復旧パスワード（確認）", { exact: true }).fill("e2e secure recovery password");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "内容を確認して保存" }).click();
  await expect(page.getByText("暗号化クラウドバックアップを保存しました。復旧パスワードは運営側では確認できません。")).toBeVisible();
  expect(JSON.stringify(savedEnvelope)).not.toContain("クラウド保存前プラン");

  await openView(page, "profile");
  await page.getByLabel("プラン名").fill("復元前の変更プラン");
  await openView(page, "data");
  await expect(page.getByText("復元するバックアップを選択し、保存したときの復旧パスワードを入力してから実行します。")).toBeVisible();
  await page.getByLabel("復元するバックアップ").selectOption(backup.id);
  await page.getByLabel("保存時の復旧パスワード").fill("e2e secure recovery password");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "復元内容を確認" }).click();
  await expect(page.getByText("暗号化クラウドバックアップから復元しました。")).toBeVisible();
  await openView(page, "profile");
  await expect(page.getByLabel("プラン名")).toHaveValue("クラウド保存前プラン");

  await openView(page, "data");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("cloud-backup-panel").getByRole("button", { name: "削除", exact: true }).click();
  await expect(page.getByText("暗号化クラウドバックアップを削除しました。")).toBeVisible();
  await expect(page.getByText("クラウドバックアップはまだありません。")).toBeVisible();
});
