import type { LifePlan, ViewKey } from "../types";
import { getGoalPreparedPercent } from "./calculations";

export type ThemePreference = "light" | "dark" | "system";
export type ReviewReminderInterval = "monthly" | "quarterly";

export type AppSettings = {
  theme: ThemePreference;
  remindersEnabled: boolean;
  actualReminderDay: number;
  reviewReminderInterval: ReviewReminderInterval;
  browserNotifications: boolean;
};

export type AppReminder = {
  id: string;
  title: string;
  detail: string;
  view: ViewKey;
};

const SETTINGS_KEY = "life-compass-app-settings-v1";

export const defaultSettings: AppSettings = {
  theme: "system",
  remindersEnabled: true,
  actualReminderDay: 25,
  reviewReminderInterval: "monthly",
  browserNotifications: false
};

export const loadAppSettings = (): AppSettings => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
};

export const saveAppSettings = (settings: AppSettings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

export const resolveTheme = (theme: ThemePreference) => {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const getAppReminders = (plan: LifePlan, settings: AppSettings, now = new Date()): AppReminder[] => {
  if (!settings.remindersEnabled) return [];

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const monthKey = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;
  const reminders: AppReminder[] = [];
  const budgetItems = plan.budgetItems || [];
  const missingActualCount = budgetItems.filter(
    (item) => !Object.prototype.hasOwnProperty.call(item.actuals || {}, monthKey)
  ).length;

  if (budgetItems.length > 0 && now.getDate() >= settings.actualReminderDay && missingActualCount > 0) {
    reminders.push({
      id: `actual-${monthKey}`,
      title: `${currentMonth}月の実績入力`,
      detail: `未入力の予算項目が${missingActualCount}件あります。月末の大まかな支出を記録します。`,
      view: "budget"
    });
  }

  const latestReview = [...(plan.reviews || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
  const reviewIntervalDays = settings.reviewReminderInterval === "quarterly" ? 90 : 30;
  const latestReviewDate = latestReview ? new Date(`${latestReview.date}T00:00:00`) : null;
  const daysSinceReview = latestReviewDate
    ? Math.floor((now.getTime() - latestReviewDate.getTime()) / (24 * 60 * 60 * 1000))
    : reviewIntervalDays;
  if (daysSinceReview >= reviewIntervalDays) {
    reminders.push({
      id: `review-${settings.reviewReminderInterval}`,
      title: settings.reviewReminderInterval === "quarterly" ? "四半期レビューの確認" : "月次レビューの確認",
      detail: latestReview ? `前回の確認から約${daysSinceReview}日です。` : "最初の見直し内容を記録できます。",
      view: "reviews"
    });
  }

  const dueGoals = plan.goals.filter(
    (goal) =>
      (goal.dueYear < currentYear || (goal.dueYear === currentYear && goal.dueMonth <= currentMonth)) &&
      goal.goalType === "oneTime" &&
      getGoalPreparedPercent(goal) < 100
  );
  if (dueGoals.length > 0) {
    reminders.push({
      id: `goals-${currentYear}`,
      title: "期限を迎える目標があります",
      detail: `${dueGoals.slice(0, 2).map((goal) => goal.title).join("、")}の準備状況を確認します。`,
      view: "goals"
    });
  }

  const upcomingEvents = plan.events.filter((event) => {
    const monthDifference = (event.year - currentYear) * 12 + event.month - currentMonth;
    return monthDifference >= 0 && monthDifference <= 2;
  });
  if (upcomingEvents.length > 0) {
    reminders.push({
      id: `events-${monthKey}`,
      title: "近いライフイベントを確認",
      detail: `${upcomingEvents.slice(0, 2).map((event) => event.title).join("、")}が3か月以内に予定されています。`,
      view: "timeline"
    });
  }

  return reminders;
};
