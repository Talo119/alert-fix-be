export const ReminderType = {
  REMINDER: 'REMINDER', // recordatorio manual de una orden (spec 11)
  CONFIRMATION: 'CONFIRMATION', // pide confirmar el próximo servicio (spec 12)
} as const;

export type ReminderType = (typeof ReminderType)[keyof typeof ReminderType];

export const REMINDER_TYPES = Object.values(ReminderType);
