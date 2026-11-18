import { Injectable, Logger } from '@nestjs/common';
import { ReminderDispatcher } from './reminder-dispatcher.js';
import type { Reminder } from './reminder.types.js';

/** Implementación temporal: solo loguea. Se reemplaza por la cola en el spec 02. */
@Injectable()
export class LoggingReminderDispatcher extends ReminderDispatcher {
  private readonly logger = new Logger(LoggingReminderDispatcher.name);

  dispatch(reminders: Reminder[]): Promise<void> {
    for (const r of reminders) {
      this.logger.log(
        `Reminder ${r.id} listo para enviar (remindAt=${r.remindAt.toISOString()})`,
      );
    }
    return Promise.resolve();
  }
}
