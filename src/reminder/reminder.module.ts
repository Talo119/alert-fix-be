import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service.js';
import { ReminderController } from './reminder.controller.js';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';
import { ReminderDispatcher } from './reminder-dispatcher.js';
import { LoggingReminderDispatcher } from './logging-reminder-dispatcher.js';

@Module({
  controllers: [ReminderController],
  providers: [
    ReminderService,
    ReminderSchedulerService,
    { provide: ReminderDispatcher, useClass: LoggingReminderDispatcher },
  ],
})
export class ReminderModule {}
