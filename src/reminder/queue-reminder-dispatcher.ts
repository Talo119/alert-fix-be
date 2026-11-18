import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { db } from '../prisma/db.js';
import { ReminderDispatcher } from './reminder-dispatcher.js';
import {
  REMINDERS_QUEUE,
  SEND_REMINDER_JOB,
  SEND_REMINDER_JOB_OPTIONS,
  type SendReminderJobData,
} from './reminder-queue.js';
import { ReminderStatus } from './reminder-status.js';
import type { Reminder } from './reminder.types.js';

/**
 * Encola un job por reminder y lo marca QUEUED.
 *
 * Orden: primero encolar, después marcar. Si el proceso cae entre ambos pasos,
 * el reminder sigue PENDING y el siguiente run lo re-encola con el mismo
 * `jobId`, que BullMQ descarta si el job aún existe.
 */
@Injectable()
export class QueueReminderDispatcher extends ReminderDispatcher {
  constructor(
    @InjectQueue(REMINDERS_QUEUE)
    private readonly queue: Queue<SendReminderJobData>,
  ) {
    super();
  }

  async dispatch(reminders: Reminder[]): Promise<void> {
    for (const r of reminders) {
      await this.queue.add(
        SEND_REMINDER_JOB,
        { reminderId: r.id },
        { ...SEND_REMINDER_JOB_OPTIONS, jobId: r.id },
      );
      await db.orm.public.Reminder.where({
        id: r.id,
        status: ReminderStatus.PENDING,
      }).update({ status: ReminderStatus.QUEUED });
    }
  }
}
