import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { db } from '../prisma/db.js';
import { REMINDERS_QUEUE, type SendReminderJobData } from './reminder-queue.js';
import { ReminderSender } from './reminder-sender.js';
import { ReminderStatus } from './reminder-status.js';

const MAX_ERROR_LENGTH = 1000;

@Processor(REMINDERS_QUEUE)
export class ReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(ReminderProcessor.name);

  constructor(private readonly sender: ReminderSender) {
    super();
  }

  async process(job: Job<SendReminderJobData>): Promise<void> {
    const { reminderId } = job.data;
    const reminder = await db.orm.public.Reminder.include('order', (o) =>
      o.include('client'),
    ).first({ id: reminderId });

    if (!reminder) {
      throw new UnrecoverableError(`Reminder ${reminderId} no existe`);
    }
    if (reminder.status === ReminderStatus.SENT) return; // idempotencia

    // Un error aquí (normal) hace que BullMQ reintente con backoff.
    await this.sender.send(reminder);

    await db.orm.public.Reminder.where({ id: reminder.id }).update({
      status: ReminderStatus.SENT,
      sentAt: new Date(),
      lastError: null,
      // externalMessageId: result.externalMessageId ?? null — llega con el spec 03
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<SendReminderJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const { reminderId } = job.data;
    // `attemptsMade` ya incluye el intento que acaba de fallar.
    const final =
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1);

    this.logger.warn(
      `Reminder ${reminderId} falló (intento ${job.attemptsMade}${final ? ', definitivo' : ''}): ${error.message}`,
    );

    try {
      await db.orm.public.Reminder.where({ id: reminderId }).update({
        lastError: error.message.slice(0, MAX_ERROR_LENGTH),
        ...(final ? { status: ReminderStatus.FAILED } : {}),
      });
    } catch (updateError) {
      this.logger.error(
        `No se pudo registrar el fallo del reminder ${reminderId}`,
        updateError instanceof Error ? updateError.stack : String(updateError),
      );
    }
  }
}
