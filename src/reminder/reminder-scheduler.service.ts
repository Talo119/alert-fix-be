// Los argumentos de @Cron se evalúan al importar este archivo: hay que cargar
// .env antes, también en tests y en `start:prod`.
import 'dotenv/config';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { db } from '../prisma/db.js';
import { startOfNextDay } from './date-utils.js';
import { ReminderDispatcher } from './reminder-dispatcher.js';
import { ReminderStatus } from './reminder-status.js';

export const REMINDERS_CRON_NAME = 'reminders-daily';
const CRON = process.env.REMINDER_CRON ?? '0 37 16 * * *'; // 6 campos: seg min hora día mes díaSemana
const TZ = process.env.REMINDER_TZ ?? 'UTC';

@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);

  constructor(private readonly dispatcher: ReminderDispatcher) {}

  @Cron(CRON, {
    name: REMINDERS_CRON_NAME,
    timeZone: TZ,
    waitForCompletion: true,
  })
  async handleCron(): Promise<void> {
    await this.processDueReminders();
  }

  /**
   * Busca los reminders PENDING con `remindAt` anterior al inicio del día
   * siguiente (incluye atrasados) y los entrega al dispatcher.
   * Público para tests y para dispararlo a mano. No captura excepciones.
   */
  async processDueReminders(now: Date = new Date()): Promise<number> {
    const until = startOfNextDay(now, TZ);
    const due = await db.orm.public.Reminder.where({
      status: ReminderStatus.PENDING,
    })
      .where((r) => r.remindAt.lt(until))
      .orderBy((r) => r.remindAt.asc())
      .all();

    this.logger.log(
      `${due.length} reminders pendientes hasta ${until.toISOString()}`,
    );
    if (due.length > 0) await this.dispatcher.dispatch(due);
    return due.length;
  }
}
