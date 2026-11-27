import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CONFIRMATION_MESSAGE } from './next-service.js';
import { OrderHeaderService } from './order-header.service.js';
import { OrderStatus } from './order-status.js';

const {
  unique,
  included,
  filtered,
  orderModel,
  entryFiltered,
  entryIncluded,
  entryModel,
  reminderModel,
  clientUnique,
  clientModel,
  companyUnique,
  companyModel,
  serviceUnique,
  serviceModel,
  orm,
  transaction,
  close,
} = vi.hoisted(() => {
  const unique = { first: vi.fn(), update: vi.fn() };
  const included = { first: vi.fn() };
  const filtered: Record<string, ReturnType<typeof vi.fn>> = {
    all: vi.fn(),
    delete: vi.fn(),
    include: vi.fn(() => included),
  };
  filtered.where = vi.fn(() => filtered);
  const orderModel = {
    create: vi.fn(),
    whereUnique: vi.fn(() => unique),
    where: vi.fn((_filter: unknown) => filtered),
  };
  const entryIncluded = { all: vi.fn() };
  const entryFiltered = {
    deleteAll: vi.fn(),
    all: vi.fn(),
    include: vi.fn(() => entryIncluded),
  };
  const entryModel = { create: vi.fn(), where: vi.fn(() => entryFiltered) };
  const reminderModel = { create: vi.fn() };
  const clientUnique = { first: vi.fn() };
  const clientModel = { whereUnique: vi.fn(() => clientUnique) };
  const companyUnique = { first: vi.fn() };
  const companyModel = { whereUnique: vi.fn(() => companyUnique) };
  const serviceUnique = { first: vi.fn() };
  const serviceModel = { whereUnique: vi.fn(() => serviceUnique) };
  const orm = {
    public: {
      OrderHeader: orderModel,
      OrderEntry: entryModel,
      Reminder: reminderModel,
      Client: clientModel,
      Company: companyModel,
      Service: serviceModel,
    },
  };
  return {
    unique,
    included,
    filtered,
    orderModel,
    entryFiltered,
    entryIncluded,
    entryModel,
    reminderModel,
    clientUnique,
    clientModel,
    companyUnique,
    companyModel,
    serviceUnique,
    serviceModel,
    orm,
    // El callback recibe un `tx` con la misma forma que `db`.
    transaction: vi.fn(async (fn: (tx: { orm: typeof orm }) => unknown) =>
      fn({ orm }),
    ),
    close: vi.fn(),
  };
});

vi.mock('../prisma/db.js', () => ({
  db: { orm, transaction, close },
}));

describe('OrderHeaderService', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const clientId = 'a1b2c3d4-1234-4abc-8def-0123456789ab';
  const companyId = 'c0ffee00-1234-4abc-8def-0123456789ab';
  const serviceA = '5e7f0000-1234-4abc-8def-0123456789ab';
  const serviceB = '5e7f0001-1234-4abc-8def-0123456789ab';
  const serviceDate = '2026-12-01T14:00:00.000Z';
  const client = { id: clientId, name: 'Ana Pérez', companyId };
  const company = { id: companyId, name: 'Acme', active: true };
  const record = {
    id,
    clientId,
    companyId,
    serviceDate: new Date(serviceDate),
    status: OrderStatus.OPEN,
  };
  const entries = [
    { serviceId: serviceA, quantity: 2 },
    { serviceId: serviceB, quantity: 1 },
  ];
  const entryRows = entries.map((entry, i) => ({
    id: `e000000${i}-1234-4abc-8def-0123456789ab`,
    orderId: id,
    ...entry,
  }));
  let service: OrderHeaderService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderHeaderService],
    }).compile();

    service = module.get<OrderHeaderService>(OrderHeaderService);
  });

  afterEach(() => {
    expect(close).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it('creates the header and its entries inside a transaction', async () => {
      clientUnique.first.mockResolvedValue(client);
      companyUnique.first.mockResolvedValue(company);
      serviceUnique.first.mockResolvedValue({ id: serviceA });
      orderModel.create.mockResolvedValue(record);
      entryModel.create
        .mockResolvedValueOnce(entryRows[0])
        .mockResolvedValueOnce(entryRows[1]);
      const dto = {
        clientId,
        companyId,
        serviceDate,
        status: OrderStatus.OPEN,
        entries,
      };

      await expect(service.create(dto)).resolves.toEqual({
        ...record,
        entries: entryRows,
      });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(clientModel.whereUnique).toHaveBeenCalledWith({ id: clientId });
      expect(companyModel.whereUnique).toHaveBeenCalledWith({ id: companyId });
      expect(serviceModel.whereUnique).toHaveBeenCalledWith({ id: serviceA });
      expect(serviceModel.whereUnique).toHaveBeenCalledWith({ id: serviceB });
      expect(orderModel.create).toHaveBeenCalledWith({
        clientId,
        companyId,
        serviceDate: expect.any(Date),
        status: OrderStatus.OPEN,
      });
      const [data] = orderModel.create.mock.calls[0] as [{ serviceDate: Date }];
      expect(data.serviceDate.toISOString()).toBe(serviceDate);
      expect(entryModel.create).toHaveBeenNthCalledWith(1, {
        ...entries[0],
        orderId: id,
      });
      expect(entryModel.create).toHaveBeenNthCalledWith(2, {
        ...entries[1],
        orderId: id,
      });
    });

    it('does not set nextServiceDate: only completing an order does', async () => {
      orderModel.create.mockResolvedValue(record);
      entryModel.create.mockResolvedValue(entryRows[0]);

      await service.create({
        serviceDate,
        status: OrderStatus.OPEN,
        entries: [{ quantity: 1 }],
      });
      const [data] = orderModel.create.mock.calls[0] as [object];
      expect(data).not.toHaveProperty('nextServiceDate');
    });

    it('checks each distinct serviceId once', async () => {
      serviceUnique.first.mockResolvedValue({ id: serviceA });
      orderModel.create.mockResolvedValue(record);
      entryModel.create.mockResolvedValue(entryRows[0]);

      await service.create({
        serviceDate,
        status: OrderStatus.OPEN,
        entries: [
          { serviceId: serviceA, quantity: 1 },
          { serviceId: serviceA, quantity: 3 },
        ],
      });
      expect(serviceModel.whereUnique).toHaveBeenCalledTimes(1);
      expect(entryModel.create).toHaveBeenCalledTimes(2);
    });

    it('creates an order without client, company or service and does not query them', async () => {
      const bare = { ...record, clientId: null, companyId: null };
      const line = { id: 'e1', orderId: id, serviceId: null, quantity: 1 };
      orderModel.create.mockResolvedValue(bare);
      entryModel.create.mockResolvedValue(line);
      const dto = {
        serviceDate,
        status: OrderStatus.OPEN,
        entries: [{ quantity: 1 }],
      };

      await expect(service.create(dto)).resolves.toEqual({
        ...bare,
        entries: [line],
      });
      expect(clientModel.whereUnique).not.toHaveBeenCalled();
      expect(companyModel.whereUnique).not.toHaveBeenCalled();
      expect(serviceModel.whereUnique).not.toHaveBeenCalled();
      expect(entryModel.create).toHaveBeenCalledWith({
        serviceId: null,
        quantity: 1,
        orderId: id,
      });
    });

    it('throws BadRequestException when the client does not exist', async () => {
      clientUnique.first.mockResolvedValue(null);

      await expect(
        service.create({
          clientId,
          serviceDate,
          status: OrderStatus.OPEN,
          entries,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderModel.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the company does not exist', async () => {
      companyUnique.first.mockResolvedValue(null);

      await expect(
        service.create({
          companyId,
          serviceDate,
          status: OrderStatus.OPEN,
          entries,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderModel.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a service does not exist', async () => {
      serviceUnique.first.mockResolvedValue(null);

      await expect(
        service.create({ serviceDate, status: OrderStatus.OPEN, entries }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderModel.create).not.toHaveBeenCalled();
      expect(entryModel.create).not.toHaveBeenCalled();
    });

    it('throws from inside the transaction when an entry fails, so it rolls back', async () => {
      serviceUnique.first.mockResolvedValue({ id: serviceA });
      orderModel.create.mockResolvedValue(record);
      entryModel.create
        .mockResolvedValueOnce(entryRows[0])
        .mockRejectedValueOnce(new Error('connection reset'));

      await expect(
        service.create({ serviceDate, status: OrderStatus.OPEN, entries }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(entryModel.create).toHaveBeenCalledTimes(2);
      // The callback rejected: that rejection is what makes Prisma roll back.
      const callback = transaction.mock.results[0];
      await expect(callback?.value).rejects.toThrow('connection reset');
    });
  });

  /** Ejecuta un predicado de `where` y devuelve el valor pasado a `status.neq`. */
  const neqValueOf = (predicate: unknown) => {
    const neq = vi.fn((_value: unknown) => 'expr');
    expect((predicate as (o: unknown) => unknown)({ status: { neq } })).toBe(
      'expr',
    );
    return neq.mock.calls[0]?.[0];
  };

  it('lists the orders that are not cancelled', async () => {
    filtered.all.mockResolvedValue([record]);

    await expect(service.findAll()).resolves.toEqual([record]);
    expect(orderModel.where).toHaveBeenCalledWith(expect.any(Function));
    expect(neqValueOf(orderModel.where.mock.calls[0]?.[0])).toBe(
      OrderStatus.CANCELLED,
    );
    expect(filtered.all).toHaveBeenCalled();
  });

  describe('findOne', () => {
    it('returns the order with its entries and each entry service', async () => {
      const withEntries = {
        ...record,
        entries: entryRows.map((entry) => ({
          ...entry,
          service: { id: entry.serviceId, name: 'Poda', description: null },
        })),
      };
      included.first.mockResolvedValue(withEntries);

      await expect(service.findOne(id)).resolves.toEqual(withEntries);
      expect(orderModel.where).toHaveBeenCalledWith({ id });
      expect(neqValueOf(filtered.where.mock.calls[0]?.[0])).toBe(
        OrderStatus.CANCELLED,
      );
      expect(filtered.include).toHaveBeenCalledWith(
        'entries',
        expect.any(Function),
      );

      // The refinement includes `service` on each entry, selecting only some fields.
      const serviceCollection = { select: vi.fn(() => 'selected') };
      const entriesCollection = {
        include: vi.fn((_: string, refine: (c: unknown) => unknown) =>
          refine(serviceCollection),
        ),
      };
      const [, refineEntries] = filtered.include.mock.calls[0] as unknown as [
        string,
        (c: unknown) => unknown,
      ];
      expect(refineEntries(entriesCollection)).toBe('selected');
      expect(entriesCollection.include).toHaveBeenCalledWith(
        'service',
        expect.any(Function),
      );
      expect(serviceCollection.select).toHaveBeenCalledWith(
        'id',
        'name',
        'description',
      );
    });

    it('throws NotFoundException when missing', async () => {
      included.first.mockResolvedValue(null);
      await expect(service.findOne(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('converts serviceDate to Date and does not touch entries without them', async () => {
      const newDate = '2026-12-03T09:30:00.000Z';
      const updated = { ...record, serviceDate: new Date(newDate) };
      unique.first.mockResolvedValue(record);
      unique.update.mockResolvedValue(updated);
      entryFiltered.all.mockResolvedValue(entryRows);

      await expect(
        service.update(id, { serviceDate: newDate }),
      ).resolves.toEqual({ ...updated, entries: entryRows });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(unique.update).toHaveBeenCalledWith({
        serviceDate: expect.any(Date),
      });
      const [data] = unique.update.mock.calls[0] as [{ serviceDate: Date }];
      expect(data.serviceDate.toISOString()).toBe(newDate);
      expect(entryFiltered.deleteAll).not.toHaveBeenCalled();
      expect(entryModel.create).not.toHaveBeenCalled();
    });

    it('does not touch the dates when the DTO omits them', async () => {
      const updated = { ...record, status: OrderStatus.CANCELLED };
      unique.first.mockResolvedValue(record);
      unique.update.mockResolvedValue(updated);
      entryFiltered.all.mockResolvedValue([]);

      await expect(
        service.update(id, { status: OrderStatus.CANCELLED }),
      ).resolves.toEqual({
        ...updated,
        entries: [],
      });
      expect(clientModel.whereUnique).not.toHaveBeenCalled();
      expect(companyModel.whereUnique).not.toHaveBeenCalled();
      expect(unique.update).toHaveBeenCalledWith({
        status: OrderStatus.CANCELLED,
      });
      const [data] = unique.update.mock.calls[0] as [object];
      expect(data).not.toHaveProperty('serviceDate');
      expect(data).not.toHaveProperty('nextServiceDate');
    });

    it('replaces all entries when the DTO sends them', async () => {
      const line = { id: 'e9', orderId: id, serviceId: null, quantity: 3 };
      unique.first.mockResolvedValue(record);
      entryModel.create.mockResolvedValue(line);
      entryFiltered.all.mockResolvedValue([line]);

      await expect(
        service.update(id, { entries: [{ quantity: 3 }] }),
      ).resolves.toEqual({ ...record, entries: [line] });
      expect(unique.update).not.toHaveBeenCalled();
      expect(entryModel.where).toHaveBeenCalledWith({ orderId: id });
      expect(entryFiltered.deleteAll).toHaveBeenCalled();
      expect(entryModel.create).toHaveBeenCalledWith({
        serviceId: null,
        quantity: 3,
        orderId: id,
      });
      expect(entryFiltered.deleteAll.mock.invocationCallOrder[0]).toBeLessThan(
        entryModel.create.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('throws BadRequestException when the client does not exist', async () => {
      unique.first.mockResolvedValue(record);
      clientUnique.first.mockResolvedValue(null);

      await expect(service.update(id, { clientId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(unique.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the company does not exist', async () => {
      unique.first.mockResolvedValue(record);
      companyUnique.first.mockResolvedValue(null);

      await expect(service.update(id, { companyId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(unique.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when a service does not exist', async () => {
      unique.first.mockResolvedValue(record);
      serviceUnique.first.mockResolvedValue(null);

      await expect(service.update(id, { entries })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(entryFiltered.deleteAll).not.toHaveBeenCalled();
      expect(entryModel.create).not.toHaveBeenCalled();
    });

    describe('OPEN → COMPLETED (spec 12)', () => {
      const now = new Date('2026-11-27T15:30:00.000Z');
      const completed = { ...record, status: OrderStatus.COMPLETED };
      const withService = (
        frequencyValue: number | null,
        frequencyUnit: string | null,
      ) => ({
        ...entryRows[0],
        service: { id: serviceA, frequencyValue, frequencyUnit, active: true },
      });

      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        unique.first.mockResolvedValue(record);
        unique.update.mockImplementation((data: object) =>
          Promise.resolve({ ...completed, ...data }),
        );
        entryFiltered.all.mockResolvedValue(entryRows);
        reminderModel.create.mockImplementation((data: object) =>
          Promise.resolve({ id: 'r', ...data }),
        );
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('sets nextServiceDate and creates 3 CONFIRMATION reminders', async () => {
        entryIncluded.all.mockResolvedValue([withService(3, 'MONTH')]);
        const next = new Date('2027-02-27T15:30:00.000Z');

        await expect(
          service.update(id, { status: OrderStatus.COMPLETED }),
        ).resolves.toEqual({
          ...completed,
          nextServiceDate: next,
          entries: entryRows,
        });
        expect(entryModel.where).toHaveBeenCalledWith({ orderId: id });
        expect(entryFiltered.include).toHaveBeenCalledWith('service');
        expect(unique.update).toHaveBeenNthCalledWith(1, {
          status: OrderStatus.COMPLETED,
        });
        expect(unique.update).toHaveBeenNthCalledWith(2, {
          nextServiceDate: next,
        });
        expect(reminderModel.create).toHaveBeenCalledTimes(3);
        const remindAts = [
          '2027-01-27T15:30:00.000Z',
          '2027-02-12T15:30:00.000Z',
          '2027-02-20T15:30:00.000Z',
        ];
        remindAts.forEach((remindAt, i) => {
          expect(reminderModel.create).toHaveBeenNthCalledWith(i + 1, {
            orderId: id,
            type: 'CONFIRMATION',
            status: 'PENDING',
            message: CONFIRMATION_MESSAGE,
            remindAt: new Date(remindAt),
          });
        });
      });

      it('uses the shortest frequency and skips past reminder dates', async () => {
        entryIncluded.all.mockResolvedValue([
          withService(3, 'MONTH'),
          withService(20, 'DAY'),
          { ...entryRows[1], serviceId: null, service: null },
        ]);

        await service.update(id, { status: OrderStatus.COMPLETED });
        expect(unique.update).toHaveBeenNthCalledWith(2, {
          nextServiceDate: new Date('2026-12-17T15:30:00.000Z'),
        });
        expect(reminderModel.create).toHaveBeenCalledTimes(2);
      });

      it('completes without frequency: nextServiceDate null, no reminders, warns', async () => {
        const warn = vi
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
        entryIncluded.all.mockResolvedValue([withService(null, null)]);

        await expect(
          service.update(id, { status: OrderStatus.COMPLETED }),
        ).resolves.toMatchObject({
          status: OrderStatus.COMPLETED,
          nextServiceDate: null,
        });
        expect(unique.update).toHaveBeenNthCalledWith(2, {
          nextServiceDate: null,
        });
        expect(reminderModel.create).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('without service frequency'),
        );
        warn.mockRestore();
      });

      it('does nothing when the order was already COMPLETED', async () => {
        unique.first.mockResolvedValue(completed);

        await service.update(id, { status: OrderStatus.COMPLETED });
        expect(entryFiltered.include).not.toHaveBeenCalled();
        expect(unique.update).toHaveBeenCalledTimes(1);
        expect(reminderModel.create).not.toHaveBeenCalled();
      });

      it('does nothing on a PATCH that keeps the order OPEN', async () => {
        await service.update(id, { serviceDate });
        expect(entryFiltered.include).not.toHaveBeenCalled();
        expect(reminderModel.create).not.toHaveBeenCalled();
      });

      it('reads the frequency from the new entries when the PATCH replaces them', async () => {
        serviceUnique.first.mockResolvedValue({ id: serviceB });
        entryModel.create.mockResolvedValue(entryRows[1]);
        entryIncluded.all.mockResolvedValue([withService(20, 'DAY')]);

        await service.update(id, {
          status: OrderStatus.COMPLETED,
          entries: [{ serviceId: serviceB, quantity: 1 }],
        });
        expect(entryModel.create.mock.invocationCallOrder[0]).toBeLessThan(
          entryIncluded.all.mock.invocationCallOrder[0] ?? 0,
        );
        expect(reminderModel.create).toHaveBeenCalledTimes(2);
      });

      it('rolls back when a reminder cannot be created', async () => {
        entryIncluded.all.mockResolvedValue([withService(3, 'MONTH')]);
        reminderModel.create.mockRejectedValueOnce(new Error('insert failed'));

        await expect(
          service.update(id, { status: OrderStatus.COMPLETED }),
        ).rejects.toBeInstanceOf(InternalServerErrorException);
        const callback = transaction.mock.results[0];
        await expect(callback?.value).rejects.toThrow('insert failed');
      });
    });

    it('throws NotFoundException when missing and writes nothing', async () => {
      unique.first.mockResolvedValue(null);

      await expect(
        service.update(id, { status: OrderStatus.COMPLETED, entries }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(unique.update).not.toHaveBeenCalled();
      expect(entryFiltered.deleteAll).not.toHaveBeenCalled();
      expect(entryModel.create).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes the order, even when it is cancelled', async () => {
      const cancelled = { ...record, status: OrderStatus.CANCELLED };
      unique.first.mockResolvedValue(cancelled);
      filtered.delete.mockResolvedValue(cancelled);

      await expect(service.remove(id)).resolves.toEqual(cancelled);
      expect(orderModel.whereUnique).toHaveBeenCalledWith({ id });
      expect(orderModel.where).toHaveBeenCalledWith({ id });
      expect(filtered.delete).toHaveBeenCalled();
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);

      await expect(service.remove(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(filtered.delete).not.toHaveBeenCalled();
    });
  });

  it('turns database errors into InternalServerErrorException', async () => {
    filtered.all.mockRejectedValue(new Error('connection refused'));
    await expect(service.findAll()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
