import { Injectable, Logger } from '@nestjs/common';
import { ReminderSender, type ReminderSendResult } from './reminder-sender.js';
import type { ReminderWithClient } from './reminder.types.js';

/** Implementación temporal: solo loguea. Se reemplaza por WhatsApp en el spec 03. */
@Injectable()
export class LoggingReminderSender extends ReminderSender {
  private readonly logger = new Logger(LoggingReminderSender.name);

  send(reminder: ReminderWithClient): Promise<ReminderSendResult> {
    const client = reminder.order?.client;
    this.logger.log(
      `Enviando reminder ${reminder.id} a ${client?.name ?? '(sin cliente)'}`,
    );
    return Promise.resolve({});
  }
}
