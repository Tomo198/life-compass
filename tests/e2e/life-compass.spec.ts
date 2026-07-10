import { expect, test, type Page } from "@playwright/test";

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
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("基本入力が画面移動と再読み込み後も保存される", async ({ page }) => {
  await openView(page, "profile");
  await page.getByLabel("プラン名").fill("E2E確認プラン");
  const ageInput = page.getByLabel("現在の年齢");
  await ageInput.fill("42");
  await ageInput.blur();

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
  await expect(page.getByRole("button", { name: "データ管理を開く" })).toBeVisible();
});

test("無料版とPro版の境界が表示され、横方向にはみ出さない", async ({ page }, testInfo) => {
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-mode", "preview");
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-tier", "free");
  await openView(page, "household");
  await expect(page.getByText("Proプレビュー", { exact: true })).toBeVisible();
  await openView(page, "simulation");
  await expect(page.getByRole("button", { name: "詳細積立 Pro" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取り崩し Pro" })).toBeVisible();

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
    const comparisonOverflow = await page.getByTestId("pricing-comparison-mobile").evaluate(
      (element) => element.scrollWidth - element.clientWidth
    );
    expect(comparisonOverflow).toBeLessThanOrEqual(1);
  } else {
    await expect(page.getByRole("cell", { name: "ブラウザ内保存・JSONバックアップ", exact: true })).toBeVisible();
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "開発中のPro機能を確認する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "シナリオ比較", level: 1 })).toBeVisible();
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-mode", "preview");
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-tier", "free");
});

test("詳細シミュレーションのグラフを操作して試算値を確認できる", async ({ page }) => {
  await openView(page, "simulation");
  await page.getByRole("button", { name: "詳細積立 Pro" }).click();

  const contributionPoint = page.getByRole("button", { name: /15年目 中央値/ });
  await contributionPoint.click();
  const contributionDetails = page.locator(".chart-selection-panel");
  await expect(contributionDetails).toContainText("15年目 / 中央値");
  await expect(contributionDetails).toContainText("下位10%");
  await expect(contributionDetails).toContainText("最頻帯");
  await expect(contributionDetails).toContainText("上位10%");

  await page.getByRole("button", { name: "取り崩し Pro" }).click();
  await page.getByRole("button", { name: /72歳 中央値/ }).click();
  const withdrawalDetails = page.locator(".chart-selection-panel");
  await expect(withdrawalDetails).toContainText("72歳 / 中央値");
  await expect(withdrawalDetails).toContainText("取り崩し額");

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
