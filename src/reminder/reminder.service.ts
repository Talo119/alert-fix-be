import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { UpdateReminderDto } from './dto/update-reminder.dto.js';
import { ReminderStatus } from './reminder-status.js';

/** Estados en los que el envío ya está en curso o terminó: no se pueden editar. */
const LOCKED_STATUSES: string[] = [ReminderStatus.QUEUED, ReminderStatus.SENT];

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  async create(createReminderDto: CreateReminderDto) {
    try {
      const { remindAt, ...rest } = createReminderDto;
      await this.assertOrderExists(rest.orderId);
      const reminder = await db.orm.public.Reminder.create({
        ...rest,
        remindAt: new Date(remindAt),
        status: ReminderStatus.PENDING,
      });
      this.logger.log(`Created reminder ${reminder.id}`);
      return reminder;
    } catch (error) {
      this.handleError('Failed to create reminder', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.Reminder.all();
    } catch (error) {
      this.handleError('Failed to fetch reminders', error);
    }
  }

  async findOne(id: string) {
    try {
      const reminder = await db.orm.public.Reminder.whereUnique({ id }).first();
      if (!reminder) throw new NotFoundException(`Reminder ${id} not found`);
      return reminder;
    } catch (error) {
      this.handleError(`Failed to fetch reminder ${id}`, error);
    }
  }

  async update(id: string, updateReminderDto: UpdateReminderDto) {
    try {
      const { status } = await this.findOne(id);
      if (LOCKED_STATUSES.includes(status)) {
        throw new ConflictException(
          `Reminder ${id} is ${status} and cannot be modified`,
        );
      }
      const { remindAt, ...rest } = updateReminderDto;
      await this.assertOrderExists(rest.orderId);
      const reminder = await db.orm.public.Reminder.whereUnique({ id }).update({
        ...rest,
        ...(remindAt !== undefined && { remindAt: new Date(remindAt) }),
      });
      this.logger.log(`Updated reminder ${id}`);
      return reminder;
    } catch (error) {
      this.handleError(`Failed to update reminder ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const reminder = await db.orm.public.Reminder.where({ id }).delete();
      this.logger.log(`Removed reminder ${id}`);
      return reminder;
    } catch (error) {
      this.handleError(`Failed to remove reminder ${id}`, error);
    }
  }

  private async assertOrderExists(orderId?: string | null) {
    if (!orderId) return;
    const order = await db.orm.public.OrderHeader.whereUnique({
      id: orderId,
    }).first();
    if (!order) {
      throw new BadRequestException(`OrderHeader ${orderId} does not exist`);
    }
  }

  private handleError(message: string, error: unknown): never {
    if (error instanceof HttpException) throw error;
    this.logger.error(
      message,
      error instanceof Error ? error.message : String(error),
    );
    throw new InternalServerErrorException(message);
  }
}
