import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { WhatsappApiError } from '../whatsapp/whatsapp-api.error.js';
import {
  WHATSAPP_CONFIG,
  type WhatsappConfig,
} from '../whatsapp/whatsapp.config.js';
import { normalizePhone, sanitizeParam } from '../whatsapp/whatsapp-format.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { confirmPayload } from '../whatsapp-webhook/confirm-payload.js';
import { formatServiceDate } from './date-utils.js';
import { ReminderSender, type ReminderSendResult } from './reminder-sender.js';
import { ReminderType } from './reminder-type.js';
import type { ReminderWithClient } from './reminder.types.js';

/**
 * Envía el reminder como plantilla de WhatsApp:
 * `{{1}}` nombre del cliente, `{{2}}` fecha del servicio, `{{3}}` mensaje.
 * Los `CONFIRMATION` (spec 12) usan su propia plantilla y `nextServiceDate`,
 * y llevan el botón "Confirmar" con payload `CONFIRM:<reminderId>` (spec 13).
 */
@Injectable()
export class WhatsappReminderSender extends ReminderSender {
  private readonly timeZone = process.env.REMINDER_TZ ?? 'UTC';

  constructor(
    private readonly whatsapp: WhatsappService,
    @Inject(WHATSAPP_CONFIG) private readonly cfg: WhatsappConfig,
  ) {
    super();
  }

  async send(reminder: ReminderWithClient): Promise<ReminderSendResult> {
    const order = reminder.order;
    const client = order?.client;
    if (!order || !client) {
      throw new UnrecoverableError(
        `Reminder ${reminder.id}: no tiene orden o cliente asociado`,
      );
    }
    if (!client.active) {
      throw new UnrecoverableError(`Reminder ${reminder.id}: cliente inactivo`);
    }
    const to = normalizePhone(client.phoneNumber, this.cfg.defaultCountryCode);
    if (!to) {
      throw new UnrecoverableError(
        `Reminder ${reminder.id}: el cliente no tiene teléfono válido`,
      );
    }

    const isConfirmation = reminder.type === ReminderType.CONFIRMATION;
    const date = isConfirmation ? order.nextServiceDate : order.serviceDate;
    if (!date) {
      throw new UnrecoverableError(
        `Reminder ${reminder.id}: la orden no tiene nextServiceDate`,
      );
    }

    try {
      const { messageId } = await this.whatsapp.sendTemplate({
        to,
        template: isConfirmation
          ? this.cfg.confirmationTemplateName
          : this.cfg.templateName,
        language: this.cfg.templateLang,
        bodyParams: [
          client.name,
          formatServiceDate(date, this.timeZone),
          reminder.message,
        ].map(sanitizeParam),
        ...(isConfirmation && {
          buttonPayloads: [confirmPayload(reminder.id)],
        }),
      });
      return { externalMessageId: messageId };
    } catch (error) {
      // Errores definitivos (token, plantilla, número…): sin reintentos.
      if (error instanceof WhatsappApiError && !error.retryable) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }
}
