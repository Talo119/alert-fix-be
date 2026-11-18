import type { JobsOptions } from 'bullmq';

export const REMINDERS_QUEUE = 'reminders';
export const SEND_REMINDER_JOB = 'send-reminder';

export interface SendReminderJobData {
  reminderId: string;
}

/** Intentos totales por job (el primero + 4 reintentos). */
export const SEND_REMINDER_ATTEMPTS = 5;
/** Backoff exponencial: 1m, 2m, 4m, 8m entre intentos. */
export const SEND_REMINDER_BACKOFF_MS = 60_000;

/** Opciones de cada job; `jobId` se añade por reminder para deduplicar. */
export const SEND_REMINDER_JOB_OPTIONS = {
  attempts: SEND_REMINDER_ATTEMPTS,
  backoff: { type: 'exponential', delay: SEND_REMINDER_BACKOFF_MS },
  removeOnComplete: true,
  removeOnFail: 1000, // conservar los últimos 1000 fallidos para diagnóstico
} as const satisfies JobsOptions;
