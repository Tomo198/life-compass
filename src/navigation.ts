import type { ViewKey } from "./types";

export const navItems: { key: ViewKey; label: string; tier?: "pro" }[] = [
  { key: "dashboard", label: "ダッシュボード" },
  { key: "profile", label: "ライフプラン" },
  { key: "assets", label: "資産入力" },
  { key: "household", label: "家計入力" },
  { key: "budget", label: "予算・実績" },
  { key: "goals", label: "目標管理" },
  { key: "simulation", label: "シミュレーション" },
  { key: "events", label: "イベント設定" },
  { key: "timeline", label: "年表" },
  { key: "notes", label: "メモ" },
  { key: "retirement", label: "老後プラン", tier: "pro" },
  { key: "scenarios", label: "シナリオ比較", tier: "pro" },
  { key: "diagnosis", label: "ライフプラン診断", tier: "pro" },
  { key: "reviews", label: "レビューセンター", tier: "pro" },
  { key: "data", label: "データ管理" },
  { key: "pricing", label: "Pro・料金" },
  { key: "legal", label: "法務" }
];

export type MobileNavKey = "home" | "household" | "goals" | "forecast" | "menu";

export const mobilePrimaryNavItems: Array<{ key: MobileNavKey; label: string; view?: ViewKey }> = [
  { key: "home", label: "ホーム", view: "dashboard" },
  { key: "household", label: "家計", view: "household" },
  { key: "goals", label: "目標", view: "goals" },
  { key: "forecast", label: "見通し", view: "simulation" },
  { key: "menu", label: "メニュー" }
];

const mobileViewGroups: Record<Exclude<MobileNavKey, "menu">, ViewKey[]> = {
  home: ["dashboard"],
  household: ["profile", "assets", "household", "budget"],
  goals: ["goals", "events", "timeline", "notes"],
  forecast: ["simulation", "retirement"]
};

export const getMobileNavKey = (view: ViewKey): MobileNavKey =>
  (Object.entries(mobileViewGroups).find(([, views]) => views.includes(view))?.[0] as MobileNavKey | undefined) || "menu";

const publicRoutes: Partial<Record<ViewKey, string>> = {
  dashboard: "/",
  pricing: "/pricing",
  pro: "/pro",
  legal: "/legal",
  terms: "/terms",
  privacy: "/privacy",
  commercial: "/commercial-disclosure",
  refund: "/refund",
  contact: "/contact",
  disclaimer: "/disclaimer"
};

const routeViews = Object.entries(publicRoutes).reduce<Record<string, ViewKey>>((routes, [view, path]) => {
  if (path) routes[path] = view as ViewKey;
  return routes;
}, {});

const publicViewTitles: Partial<Record<ViewKey, string>> = {
  terms: "利用規約",
  privacy: "プライバシーポリシー",
  commercial: "特定商取引法に基づく表記",
  refund: "解約・返金方針",
  contact: "お問い合わせ",
  disclaimer: "免責事項"
};

const legalDocumentViews: ViewKey[] = ["terms", "privacy", "commercial", "refund", "contact", "disclaimer"];

export const getViewForPath = (pathname: string): ViewKey =>
  routeViews[pathname.replace(/\/$/, "") || "/"] || "dashboard";

export const getPublicPath = (view: ViewKey) => publicRoutes[view] || "/";

export const getViewTitle = (view: ViewKey) =>
  publicViewTitles[view] ||
  (view === "settings" ? "設定" : view === "pro" ? "Pro・料金" : navItems.find((item) => item.key === view)?.label) ||
  "Life Compass";

export const isLegalDocumentView = (view: ViewKey) => legalDocumentViews.includes(view);
