import { Inject, Injectable, Logger } from '@nestjs/common';
import { OrderHeaderService } from '../order-header/order-header.service.js';
import { db } from '../prisma/db.js';
import { formatServiceDate } from '../reminder/date-utils.js';
import { ReminderType } from '../reminder/reminder-type.js';
import {
  WHATSAPP_CONFIG,
  type WhatsappConfig,
} from '../whatsapp/whatsapp.config.js';
import { normalizePhone, sanitizeParam } from '../whatsapp/whatsapp-format.js';
import { maskPhone, WhatsappService } from '../whatsapp/whatsapp.service.js';
import { parseConfirmPayload } from './confirm-payload.js';
import type { ButtonReply } from './whatsapp-webhook.types.js';

/** Cierra la frase sin duplicar el punto de `a. m.`/`p. m.` de la fecha. */
const period = (text: string) => (text.endsWith('.') ? text : `${text}.`);

export const CREATED_TEXT = (name: string, date: string) =>
  period(`¡Listo, ${name}! Agendamos tu mantenimiento para el ${date}`);
export const DUPLICATE_TEXT = (name: string, date: string) =>
  period(`${name}, tu mantenimiento ya está agendado para el ${date}`);

/**
 * Botón "Confirmar" de un reminder `CONFIRMATION` → orden del próximo
 * servicio (spec 13). Los rechazos de negocio se registran y terminan sin
 * lanzar (el webhook responde 200); los errores de BD se propagan (500).
 */
@Injectable()
export class WhatsappConfirmationService {
  private readonly logger = new Logger(WhatsappConfirmationService.name);
  private readonly timeZone = process.env.REMINDER_TZ ?? 'UTC';

  constructor(
    private readonly orderHeaderService: OrderHeaderService,
    private readonly whatsapp: WhatsappService,
    @Inject(WHATSAPP_CONFIG) private readonly cfg: WhatsappConfig,
  ) {}

  async handle({ from, payload }: ButtonReply): Promise<void> {
    const reminderId = parseConfirmPayload(payload);
    if (!reminderId) {
      this.logger.warn(
        `Botón con payload desconocido: ${payload.slice(0, 64)}`,
      );
      return;
    }

    const reminder = await db.orm.public.Reminder.include('order', (o) =>
      o.include('client'),
    ).first({ id: reminderId });
    if (
      !reminder ||
      reminder.type !== ReminderType.CONFIRMATION ||
      !reminder.orderId
    ) {
      this.logger.warn(
        `Reminder ${reminderId}: no existe o no es un CONFIRMATION con orden`,
      );
      return;
    }

    const client = reminder.order?.client;
    if (!client?.active) {
      this.logger.warn(
        `Reminder ${reminderId}: cliente inexistente o inactivo`,
      );
      return;
    }
    const phone = normalizePhone(
      client.phoneNumber,
      this.cfg.defaultCountryCode,
    );
    if (phone !== from) {
      this.logger.warn(
        `Reminder ${reminderId}: remitente ${maskPhone(from)} no es el cliente`,
      );
      return;
    }

    const result = await this.orderHeaderService.createFollowUp(
      reminder.orderId,
    );
    if (!result) return;

    // `Intl` separa `a. m.` con espacios no separables: se normalizan.
    const date = sanitizeParam(
      formatServiceDate(result.order.serviceDate, this.timeZone),
    );
    const text = result.created
      ? CREATED_TEXT(client.name, date)
      : DUPLICATE_TEXT(client.name, date);
    try {
      await this.whatsapp.sendText(from, text);
    } catch (error) {
      // La orden ya está creada: no se propaga para que Meta no reintente.
      this.logger.error(
        `Reminder ${reminderId}: no se pudo responder a ${maskPhone(from)}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
