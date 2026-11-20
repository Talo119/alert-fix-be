import { Module } from '@nestjs/common';
import { OrderEntryService } from './order-entry.service.js';
import { OrderEntryController } from './order-entry.controller.js';

@Module({
  controllers: [OrderEntryController],
  providers: [OrderEntryService],
})
export class OrderEntryModule {}
