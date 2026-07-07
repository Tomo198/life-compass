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
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-mode", "preview");
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-access-tier", "free");
  await page.locator('[data-view="household"]').click();
  await expect(page.getByText("Proプレビュー", { exact: true })).toBeVisible();
  await page.locator('[data-view="simulation"]').click();
  await expect(page.getByRole("button", { name: "詳細積立 Pro" })).toBeVisible();
  await expect(page.getByRole("button", { name: "取り崩し Pro" })).toBeVisible();

  await page.locator('[data-view="pricing"]').click();
  await expect(page.getByRole("heading", { name: "無料版とPro版の比較" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "ブラウザ内保存・JSONバックアップ", exact: true })).toBeVisible();
  await expect(page.getByText("現在は申込みと課金を受け付けていません。開発中のPro機能は、確認用のプレビューとして開くことができます。")).toBeVisible();
  await expect(page.getByTestId("access-summary")).toContainText("課金なし・プレビュー");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("詳細シミュレーションのグラフを操作して試算値を確認できる", async ({ page }) => {
  await page.locator('[data-view="simulation"]').click();
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
