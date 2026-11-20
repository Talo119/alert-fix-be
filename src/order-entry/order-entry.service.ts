import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { CreateOrderEntryDto } from './dto/create-order-entry.dto.js';
import { UpdateOrderEntryDto } from './dto/update-order-entry.dto.js';

@Injectable()
export class OrderEntryService {
  private readonly logger = new Logger(OrderEntryService.name);

  async create(createOrderEntryDto: CreateOrderEntryDto) {
    try {
      await this.assertReferencesExist(createOrderEntryDto);
      const entry = await db.orm.public.OrderEntry.create(createOrderEntryDto);
      this.logger.log(`Created order entry ${entry.id}`);
      return entry;
    } catch (error) {
      this.handleError('Failed to create order entry', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.OrderEntry.all();
    } catch (error) {
      this.handleError('Failed to fetch order entries', error);
    }
  }

  async findOne(id: string) {
    try {
      const entry = await db.orm.public.OrderEntry.whereUnique({ id }).first();
      if (!entry) throw new NotFoundException(`OrderEntry ${id} not found`);
      return entry;
    } catch (error) {
      this.handleError(`Failed to fetch order entry ${id}`, error);
    }
  }

  async update(id: string, updateOrderEntryDto: UpdateOrderEntryDto) {
    try {
      await this.findOne(id);
      await this.assertReferencesExist(updateOrderEntryDto);
      const entry = await db.orm.public.OrderEntry.whereUnique({ id }).update(
        updateOrderEntryDto,
      );
      this.logger.log(`Updated order entry ${id}`);
      return entry;
    } catch (error) {
      this.handleError(`Failed to update order entry ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const entry = await db.orm.public.OrderEntry.where({ id }).delete();
      this.logger.log(`Removed order entry ${id}`);
      return entry;
    } catch (error) {
      this.handleError(`Failed to remove order entry ${id}`, error);
    }
  }

  private async assertReferencesExist({
    orderId,
    serviceId,
  }: UpdateOrderEntryDto) {
    if (orderId) {
      const order = await db.orm.public.OrderHeader.whereUnique({
        id: orderId,
      }).first();
      if (!order) {
        throw new BadRequestException(`OrderHeader ${orderId} does not exist`);
      }
    }
    if (serviceId) {
      const service = await db.orm.public.Service.whereUnique({
        id: serviceId,
      }).first();
      if (!service) {
        throw new BadRequestException(`Service ${serviceId} does not exist`);
      }
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
