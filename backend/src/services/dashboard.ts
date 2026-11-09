import { listRecentEvents, type ActivityItem } from "../repositories/events.js";
import type { ServiceContext } from "./context.js";
import { dashboardJobStats } from "./jobs.js";
import { dashboardApplicationStats } from "./applications.js";
import { dashboardReminderStats, type ReminderSummary } from "./reminders.js";

export interface DashboardDto {
  jobs: {
    total: number;
    deleted: number;
    byStatus: Record<string, number>;
  };
  applications: {
    total: number;
    byStatus: Record<string, number>;
  };
  reminders: ReminderSummary;
  activity: ActivityItem[];
}

/** Todos os números vêm do banco real — nada simulado. */
export function getDashboard(ctx: ServiceContext, activityLimit = 10): DashboardDto {
  return {
    jobs: dashboardJobStats(ctx),
    applications: dashboardApplicationStats(ctx),
    reminders: dashboardReminderStats(ctx),
    activity: listRecentEvents(ctx.holder.get(), activityLimit),
  };
}

export function getActivity(ctx: ServiceContext, limit: number) {
  return { items: listRecentEvents(ctx.holder.get(), limit) };
}
