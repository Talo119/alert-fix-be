import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderEntryService } from './order-entry.service.js';

const {
  unique,
  filtered,
  entryModel,
  orderUnique,
  orderModel,
  serviceUnique,
  serviceModel,
  close,
} = vi.hoisted(() => {
  const unique = { first: vi.fn(), update: vi.fn() };
  const filtered = { delete: vi.fn() };
  const entryModel = {
    create: vi.fn(),
    all: vi.fn(),
    whereUnique: vi.fn(() => unique),
    where: vi.fn(() => filtered),
  };
  const orderUnique = { first: vi.fn() };
  const orderModel = { whereUnique: vi.fn(() => orderUnique) };
  const serviceUnique = { first: vi.fn() };
  const serviceModel = { whereUnique: vi.fn(() => serviceUnique) };
  return {
    unique,
    filtered,
    entryModel,
    orderUnique,
    orderModel,
    serviceUnique,
    serviceModel,
    close: vi.fn(),
  };
});

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        OrderEntry: entryModel,
        OrderHeader: orderModel,
        Service: serviceModel,
      },
    },
    close,
  },
}));

describe('OrderEntryService', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const orderId = 'a1b2c3d4-1234-4abc-8def-0123456789ab';
  const serviceId = 'c0ffee00-1234-4abc-8def-0123456789ab';
  const order = { id: orderId, status: 'SCHEDULED' };
  const catalogService = {
    id: serviceId,
    name: 'Mantenimiento de aire acondicionado',
  };
  const record = { id, orderId, serviceId, quantity: 2 };
  let service: OrderEntryService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [OrderEntryService],
    }).compile();

    service = module.get<OrderEntryService>(OrderEntryService);
  });

  afterEach(() => {
    expect(close).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it('creates an entry when the order and the service exist', async () => {
      orderUnique.first.mockResolvedValue(order);
      serviceUnique.first.mockResolvedValue(catalogService);
      entryModel.create.mockResolvedValue(record);
      const dto = { orderId, serviceId, quantity: 2 };

      await expect(service.create(dto)).resolves.toEqual(record);
      expect(orderModel.whereUnique).toHaveBeenCalledWith({ id: orderId });
      expect(serviceModel.whereUnique).toHaveBeenCalledWith({ id: serviceId });
      expect(entryModel.create).toHaveBeenCalledWith(dto);
    });

    it('creates an entry without order or service and does not query them', async () => {
      const bare = { ...record, orderId: null, serviceId: null };
      entryModel.create.mockResolvedValue(bare);
      const dto = { quantity: 1 };

      await expect(service.create(dto)).resolves.toEqual(bare);
      expect(orderModel.whereUnique).not.toHaveBeenCalled();
      expect(serviceModel.whereUnique).not.toHaveBeenCalled();
      expect(entryModel.create).toHaveBeenCalledWith(dto);
    });

    it('throws BadRequestException when the order does not exist', async () => {
      orderUnique.first.mockResolvedValue(null);

      await expect(
        service.create({ orderId, quantity: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(entryModel.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the service does not exist', async () => {
      serviceUnique.first.mockResolvedValue(null);

      await expect(
        service.create({ serviceId, quantity: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(entryModel.create).not.toHaveBeenCalled();
    });
  });

  it('lists all entries', async () => {
    entryModel.all.mockResolvedValue([record]);

    await expect(service.findAll()).resolves.toEqual([record]);
    expect(entryModel.all).toHaveBeenCalled();
    expect(entryModel.where).not.toHaveBeenCalled();
  });

  describe('findOne', () => {
    it('returns the entry when it exists', async () => {
      unique.first.mockResolvedValue(record);
      await expect(service.findOne(id)).resolves.toEqual(record);
      expect(entryModel.whereUnique).toHaveBeenCalledWith({ id });
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);
      await expect(service.findOne(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the quantity without querying order or service', async () => {
      const updated = { ...record, quantity: 3 };
      unique.first.mockResolvedValue(record);
      unique.update.mockResolvedValue(updated);

      await expect(service.update(id, { quantity: 3 })).resolves.toEqual(
        updated,
      );
      expect(orderModel.whereUnique).not.toHaveBeenCalled();
      expect(serviceModel.whereUnique).not.toHaveBeenCalled();
      expect(unique.update).toHaveBeenCalledWith({ quantity: 3 });
    });

    it('throws BadRequestException when the order does not exist', async () => {
      unique.first.mockResolvedValue(record);
      orderUnique.first.mockResolvedValue(null);

      await expect(service.update(id, { orderId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(unique.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the service does not exist', async () => {
      unique.first.mockResolvedValue(record);
      serviceUnique.first.mockResolvedValue(null);

      await expect(service.update(id, { serviceId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(unique.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);

      await expect(service.update(id, { quantity: 3 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(unique.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes the entry', async () => {
      unique.first.mockResolvedValue(record);
      filtered.delete.mockResolvedValue(record);

      await expect(service.remove(id)).resolves.toEqual(record);
      expect(entryModel.where).toHaveBeenCalledWith({ id });
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
    entryModel.all.mockRejectedValue(new Error('connection refused'));
    await expect(service.findAll()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
