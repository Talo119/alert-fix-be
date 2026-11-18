export const ReminderStatus = {
  PENDING: 'PENDING', // creado, esperando su fecha
  QUEUED: 'QUEUED', // encolado en BullMQ (spec 02)
  SENT: 'SENT', // enviado por WhatsApp (spec 03)
  FAILED: 'FAILED', // agotó reintentos o error no recuperable
} as const;

export type ReminderStatus =
  (typeof ReminderStatus)[keyof typeof ReminderStatus];
