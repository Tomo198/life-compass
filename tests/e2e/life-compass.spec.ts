import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("基本入力が画面移動と再読み込み後も保存される", async ({ page }) => {
  await page.locator('[data-view="profile"]').click();
  await page.getByLabel("プラン名").fill("E2E確認プラン");
  const ageInput = page.getByLabel("現在の年齢");
  await ageInput.fill("42");
  await ageInput.blur();

  await page.locator('[data-view="household"]').click();
  const incomeInput = page.getByLabel("月収");
  await incomeInput.fill("450000");
  await incomeInput.blur();
  await expect(incomeInput).toHaveValue("450,000");

  await page.reload();
  await page.locator('[data-view="profile"]').click();
  await expect(page.getByLabel("プラン名")).toHaveValue("E2E確認プラン");
  await expect(page.getByLabel("現在の年齢")).toHaveValue("42");
  await page.locator('[data-view="household"]').click();
  await expect(page.getByLabel("月収")).toHaveValue("450,000");
});

test("JSONの書き出し・初期化前復旧・読み込みを行える", async ({ page }) => {
  await page.locator('[data-view="profile"]').click();
  await page.getByLabel("プラン名").fill("復旧確認プラン");
  await page.locator('[data-view="data"]').click();

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
  await page.locator('[data-view="profile"]').click();
  await expect(page.getByLabel("プラン名")).toHaveValue("復旧確認プラン");

  await page.locator('[data-view="data"]').click();
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
  await page.locator('[data-view="profile"]').click();
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

test("無料版とPro版の境界が表示され、横方向にはみ出さない", async ({ page }) => {
  await page.locator('[data-view="household"]').click();
  await expect(page.getByText("Proプレビュー", { exact: true })).toBeVisible();
  await page.locator('[data-view="simulation"]').click();
  await expect(page.getByRole("button", { name: "詳細積立 Pro" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取り崩し Pro" })).toBeVisible();

  await page.locator('[data-view="pricing"]').click();
  await expect(page.getByRole("heading", { name: "無料版とPro版の比較" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "ブラウザ内保存・JSONバックアップ", exact: true })).toBeVisible();
  await expect(page.getByText("Pro画面は開発中の機能を確認するためのプレビューです。")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
