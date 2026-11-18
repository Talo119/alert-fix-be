import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service.js';
import { ReminderController } from './reminder.controller.js';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';
import { ReminderDispatcher } from './reminder-dispatcher.js';
import { QueueReminderDispatcher } from './queue-reminder-dispatcher.js';
import { REMINDERS_QUEUE } from './reminder-queue.js';
import { ReminderProcessor } from './reminder.processor.js';
import { ReminderSender } from './reminder-sender.js';
import { WhatsappReminderSender } from './whatsapp-reminder-sender.js';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: REMINDERS_QUEUE }),
    WhatsappModule,
  ],
  controllers: [ReminderController],
  providers: [
    ReminderService,
    ReminderSchedulerService,
    { provide: ReminderDispatcher, useClass: QueueReminderDispatcher },
    ReminderProcessor,
    { provide: ReminderSender, useClass: WhatsappReminderSender },
  ],
})
export class ReminderModule {}
