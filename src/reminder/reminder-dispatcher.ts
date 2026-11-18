import type { Reminder } from './reminder.types.js';

/**
 * Puerto de salida de los reminders vencidos. Se usa como token de inyección
 * para poder cambiar la implementación (log → cola BullMQ) sin tocar el cron.
 */
export abstract class ReminderDispatcher {
  abstract dispatch(reminders: Reminder[]): Promise<void>;
}
