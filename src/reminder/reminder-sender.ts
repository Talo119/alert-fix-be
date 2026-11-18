import type { ReminderWithClient } from './reminder.types.js';

export interface ReminderSendResult {
  /** Id del mensaje en el proveedor (p. ej. `wamid` de WhatsApp, spec 03). */
  externalMessageId?: string;
}

/**
 * Puerto de envío de un reminder al cliente. Lo usa el worker de la cola.
 * Lanzar un error normal → BullMQ reintenta; `UnrecoverableError` → no reintenta.
 */
export abstract class ReminderSender {
  abstract send(reminder: ReminderWithClient): Promise<ReminderSendResult>;
}
