import { Injectable, Logger } from '@nestjs/common';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { UpdateReminderDto } from './dto/update-reminder.dto.js';
import { db } from '../prisma/db.js';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger('ReminderService');
  create(createReminderDto: CreateReminderDto) {
    return 'This action adds a new reminder';
  }

  findAll() {
    return `This action returns all reminder`;
  }

  async findOne(id: string) {
    try {
      this.logger.log(`Finding reminder with id: ${id}`);
      const reminder = await db.orm.public.Reminder.whereUnique({
        id,
      }).first();
      return reminder;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to find reminder with id: ${id}`, error.message);
      } else {
        this.logger.error(`Failed to find reminder with id: ${id}`, String(error));
      }
    }
  }

  update(id: string, updateReminderDto: UpdateReminderDto) {
    return `This action updates a #${id} reminder`;
  }

  remove(id: string) {
    return `This action removes a #${id} reminder`;
  }
}
