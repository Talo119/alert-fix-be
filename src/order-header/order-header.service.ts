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
import { OrderHeaderEntryDto } from './dto/order-header-entry.dto.js';
import { UpdateOrderHeaderDto } from './dto/update-order-header.dto.js';
import { OrderStatus } from './order-status.js';

/** `db.orm.public` o `tx.orm.public`: la misma API dentro y fuera de una transacción. */
type Orm = typeof db.orm.public;

@Injectable()
export class OrderHeaderService {
  private readonly logger = new Logger(OrderHeaderService.name);

  async create(createOrderHeaderDto: CreateOrderHeaderDto) {
    try {
      const { serviceDate, nextServiceDate, entries, ...rest } =
        createOrderHeaderDto;
      const order = await db.transaction(async (tx) => {
        const orm = tx.orm.public;
        await this.assertReferencesExist(orm, createOrderHeaderDto);
        const header = await orm.OrderHeader.create({
          ...rest,
          serviceDate: new Date(serviceDate),
          ...(nextServiceDate && {
            nextServiceDate: new Date(nextServiceDate),
          }),
        });
        const created = await this.createEntries(orm, header.id, entries);
        return { ...header, entries: created };
      });
      this.logger.log(
        `Created order ${order.id} with ${order.entries.length} entries`,
      );
      return order;
    } catch (error) {
      this.handleError('Failed to create order', error);
    }
  }

  async findAll(clientId: string) {
    try {
      // Los GET no devuelven órdenes canceladas.
      return await db.orm.public.OrderHeader.where((o) =>
        o.status.neq(OrderStatus.CANCELLED),
      )
        .where((order) => order.clientId.eq(clientId))
        .all();
    } catch (error) {
      this.handleError('Failed to fetch orders', error);
    }
  }

  async findOne(id: string) {
    try {
      // Cada línea trae su servicio (solo id, nombre y descripción).
      const order = await db.orm.public.OrderHeader.where({ id })
        .where((o) => o.status.neq(OrderStatus.CANCELLED))
        .include('entries', (entries) =>
          entries.include('service', (service) =>
            service.select('id', 'name', 'description'),
          ),
        )
        .first();
      if (!order) throw new NotFoundException(`OrderHeader ${id} not found`);
      return order;
    } catch (error) {
      this.handleError(`Failed to fetch order ${id}`, error);
    }
  }

  async update(id: string, updateOrderHeaderDto: UpdateOrderHeaderDto) {
    try {
      const { serviceDate, nextServiceDate, entries, ...rest } =
        updateOrderHeaderDto;
      const order = await db.transaction(async (tx) => {
        const orm = tx.orm.public;
        const existing = await orm.OrderHeader.whereUnique({ id }).first();
        if (!existing) {
          throw new NotFoundException(`OrderHeader ${id} not found`);
        }
        await this.assertReferencesExist(orm, updateOrderHeaderDto);

        const data = {
          ...rest,
          ...(serviceDate !== undefined && {
            serviceDate: new Date(serviceDate),
          }),
          // `@IsOptional()` deja pasar `null`: quita la fecha.
          ...(nextServiceDate !== undefined && {
            nextServiceDate: nextServiceDate ? new Date(nextServiceDate) : null,
          }),
        };
        const header =
          Object.keys(data).length > 0
            ? ((await orm.OrderHeader.whereUnique({ id }).update(data)) ??
              existing)
            : existing;

        if (entries !== undefined) {
          await orm.OrderEntry.where({ orderId: id }).deleteAll();
          await this.createEntries(orm, id, entries);
        }

        return {
          ...header,
          entries: await orm.OrderEntry.where({ orderId: id }).all(),
        };
      });
      this.logger.log(`Updated order ${id}`);
      return order;
    } catch (error) {
      this.handleError(`Failed to update order ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      // Sin `findOne`: una orden cancelada también se puede borrar.
      const existing = await db.orm.public.OrderHeader.whereUnique({
        id,
      }).first();
      if (!existing) throw new NotFoundException(`OrderHeader ${id} not found`);
      const order = await db.orm.public.OrderHeader.where({ id }).delete();
      this.logger.log(`Removed order ${id}`);
      return order;
    } catch (error) {
      this.handleError(`Failed to remove order ${id}`, error);
    }
  }

  /**
   * Crea las líneas en secuencia (no `Promise.all`): la transacción usa una
   * sola conexión y el primer fallo corta el resto.
   */
  private async createEntries(
    orm: Orm,
    orderId: string,
    entries: OrderHeaderEntryDto[],
  ) {
    const created = [];
    for (const { serviceId, quantity } of entries) {
      created.push(
        await orm.OrderEntry.create({
          serviceId: serviceId ?? null,
          quantity,
          orderId,
        }),
      );
    }
    return created;
  }

  private async assertReferencesExist(
    orm: Orm,
    { clientId, companyId, entries }: UpdateOrderHeaderDto,
  ) {
    if (clientId) {
      const client = await orm.Client.whereUnique({ id: clientId }).first();
      if (!client) {
        throw new BadRequestException(`Client ${clientId} does not exist`);
      }
    }
    if (companyId) {
      const company = await orm.Company.whereUnique({ id: companyId }).first();
      if (!company) {
        throw new BadRequestException(`Company ${companyId} does not exist`);
      }
    }
    const serviceIds = new Set(
      (entries ?? []).flatMap(({ serviceId }) =>
        serviceId ? [serviceId] : [],
      ),
    );
    for (const serviceId of serviceIds) {
      const service = await orm.Service.whereUnique({ id: serviceId }).first();
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
