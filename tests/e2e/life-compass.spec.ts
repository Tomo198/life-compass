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

test("予算実績、イベント設定、月別年表、保存容量を整理して確認できる", async ({ page }) => {
  await openView(page, "budget");
  await expect(page.getByText("月平均予算の全体像", { exact: true })).toBeVisible();
  await page.getByLabel("項目を検索").fill("食費");
  await expect(page.locator(".monthly-actual-row")).toHaveCount(1);
  await page.getByLabel("項目を検索").fill("");
  await page.getByRole("button", { name: "月別比較", exact: true }).click();
  await expect(page.getByRole("heading", { name: /カテゴリ別比較/ })).toBeVisible();
  await page.getByRole("button", { name: "年間推移", exact: true }).click();
  await expect(page.getByRole("heading", { name: /予算・実績推移/ })).toBeVisible();

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

test("設定画面でログインが任意でありクラウド保存を開始しないと確認できる", async ({ page }) => {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const accountPanel = page.getByTestId("account-panel");
  await expect(accountPanel).toBeVisible();
  await expect(accountPanel).toContainText("無料版はログインなしで利用できます");
  await expect(accountPanel).toContainText("ログインしても自動でクラウド保存しません");
  await expect(accountPanel).toContainText("Googleログインは設定中です");
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
