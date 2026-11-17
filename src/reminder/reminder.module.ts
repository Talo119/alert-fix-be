import { Module } from '@nestjs/common';
import { ReminderService } from './reminder.service.js';
import { ReminderController } from './reminder.controller.js';

@Module({
  controllers: [ReminderController],
  providers: [ReminderService],
})
export class ReminderModule {}
