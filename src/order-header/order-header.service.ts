import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { CreateOrderHeaderDto } from './dto/create-order-header.dto.js';
import { UpdateOrderHeaderDto } from './dto/update-order-header.dto.js';

@Injectable()
export class OrderHeaderService {
  private readonly logger = new Logger(OrderHeaderService.name);

  async create(createOrderHeaderDto: CreateOrderHeaderDto) {
    try {
      await this.assertReferencesExist(createOrderHeaderDto);
      const { serviceDate, ...rest } = createOrderHeaderDto;
      const order = await db.orm.public.OrderHeader.create({
        ...rest,
        serviceDate: new Date(serviceDate),
      });
      this.logger.log(`Created order ${order.id}`);
      return order;
    } catch (error) {
      this.handleError('Failed to create order', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.OrderHeader.all();
    } catch (error) {
      this.handleError('Failed to fetch orders', error);
    }
  }

  async findOne(id: string) {
    try {
      const order = await db.orm.public.OrderHeader.whereUnique({ id }).first();
      if (!order) throw new NotFoundException(`OrderHeader ${id} not found`);
      return order;
    } catch (error) {
      this.handleError(`Failed to fetch order ${id}`, error);
    }
  }

  async update(id: string, updateOrderHeaderDto: UpdateOrderHeaderDto) {
    try {
      await this.findOne(id);
      await this.assertReferencesExist(updateOrderHeaderDto);
      const { serviceDate, ...rest } = updateOrderHeaderDto;
      const order = await db.orm.public.OrderHeader.whereUnique({ id }).update({
        ...rest,
        ...(serviceDate !== undefined && {
          serviceDate: new Date(serviceDate),
        }),
      });
      this.logger.log(`Updated order ${id}`);
      return order;
    } catch (error) {
      this.handleError(`Failed to update order ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const order = await db.orm.public.OrderHeader.where({ id }).delete();
      this.logger.log(`Removed order ${id}`);
      return order;
    } catch (error) {
      this.handleError(`Failed to remove order ${id}`, error);
    }
  }

  private async assertReferencesExist({
    clientId,
    companyId,
  }: UpdateOrderHeaderDto) {
    if (clientId) {
      const client = await db.orm.public.Client.whereUnique({
        id: clientId,
      }).first();
      if (!client) {
        throw new BadRequestException(`Client ${clientId} does not exist`);
      }
    }
    if (companyId) {
      const company = await db.orm.public.Company.whereUnique({
        id: companyId,
      }).first();
      if (!company) {
        throw new BadRequestException(`Company ${companyId} does not exist`);
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
