/**
 * Notificações desktop (Fase 5.2).
 *
 * Canal escolhido: painel de pendências no Dashboard + notificação desktop do
 * navegador. Nenhuma notificação sai da máquina. Qualquer falha (API ausente,
 * permissão negada, erro ao exibir) é registrada no console e nunca quebra a
 * interface.
 */

const STORAGE_KEY = "jobpilot:notified-reminders";

export type NotificationState = "unsupported" | NotificationPermission;

export interface NotifiableReminder {
  id: number;
  dueAt: string;
  jobTitle: string;
  company?: string | null;
  message?: string | null;
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationState {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationState> {
  if (!notificationsSupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch (err) {
    console.warn("Falha ao pedir permissão de notificação:", err);
    return Notification.permission;
  }
}

/** Exibe uma notificação; devolve false (e apenas loga) em qualquer falha. */
export function sendDesktopNotification(title: string, options: NotificationOptions = {}): boolean {
  if (!notificationsSupported() || Notification.permission !== "granted") return false;
  try {
    new Notification(title, options);
    return true;
  } catch (err) {
    console.warn("Falha ao exibir notificação desktop:", err);
    return false;
  }
}

function todayStamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readNotified(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch (err) {
    console.warn("Falha ao ler o histórico de notificações:", err);
  }
  return {};
}

function writeNotified(map: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("Falha ao salvar o histórico de notificações:", err);
  }
}

/**
 * Notifica lembretes vencidos, no máximo uma vez por lembrete por dia local.
 * A marcação só é gravada quando a notificação é exibida com sucesso.
 */
export function notifyOverdueReminders(reminders: NotifiableReminder[]): number {
  if (!notificationsSupported() || Notification.permission !== "granted") return 0;

  const today = todayStamp();
  const notified = readNotified();
  for (const key of Object.keys(notified)) {
    if (notified[key] !== today) delete notified[key];
  }

  let sent = 0;
  for (const reminder of reminders) {
    const key = String(reminder.id);
    if (notified[key] === today) continue;

    const details = [reminder.company, reminder.message].filter((value): value is string =>
      Boolean(value),
    );
    const ok = sendDesktopNotification(`Acompanhamento vencido: ${reminder.jobTitle}`, {
      body: details.join(" · ") || "Abra o JobPilot para concluir este lembrete.",
      tag: `jobpilot-reminder-${reminder.id}`,
    });
    if (ok) {
      notified[key] = today;
      sent += 1;
    }
  }

  writeNotified(notified);
  return sent;
}
