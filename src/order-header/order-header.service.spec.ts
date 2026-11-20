import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrderHeaderService } from './order-header.service.js';

const {
  unique,
  filtered,
  orderModel,
  clientUnique,
  clientModel,
  companyUnique,
  companyModel,
  close,
} = vi.hoisted(() => {
  const unique = { first: vi.fn(), update: vi.fn() };
  const filtered = { delete: vi.fn() };
  const orderModel = {
    create: vi.fn(),
    all: vi.fn(),
    whereUnique: vi.fn(() => unique),
    where: vi.fn(() => filtered),
  };
  const clientUnique = { first: vi.fn() };
  const clientModel = { whereUnique: vi.fn(() => clientUnique) };
  const companyUnique = { first: vi.fn() };
  const companyModel = { whereUnique: vi.fn(() => companyUnique) };
  return {
    unique,
    filtered,
    orderModel,
    clientUnique,
    clientModel,
    companyUnique,
    companyModel,
    close: vi.fn(),
  };
});

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: {
      public: {
        OrderHeader: orderModel,
        Client: clientModel,
        Company: companyModel,
      },
    },
    close,
  },
}));

describe('OrderHeaderService', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const clientId = 'a1b2c3d4-1234-4abc-8def-0123456789ab';
  const companyId = 'c0ffee00-1234-4abc-8def-0123456789ab';
  const serviceDate = '2026-12-01T14:00:00.000Z';
  const client = { id: clientId, name: 'Ana Pérez', companyId };
  const company = { id: companyId, name: 'Acme', active: true };
  const record = {
    id,
    clientId,
    companyId,
    serviceDate: new Date(serviceDate),
    status: 'SCHEDULED',
  };
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
    it('creates an order converting serviceDate to Date', async () => {
      clientUnique.first.mockResolvedValue(client);
      companyUnique.first.mockResolvedValue(company);
      orderModel.create.mockResolvedValue(record);
      const dto = { clientId, companyId, serviceDate, status: 'SCHEDULED' };

      await expect(service.create(dto)).resolves.toEqual(record);
      expect(clientModel.whereUnique).toHaveBeenCalledWith({ id: clientId });
      expect(companyModel.whereUnique).toHaveBeenCalledWith({ id: companyId });
      expect(orderModel.create).toHaveBeenCalledWith({
        ...dto,
        serviceDate: expect.any(Date),
      });
      const [data] = orderModel.create.mock.calls[0] as [{ serviceDate: Date }];
      expect(data.serviceDate.toISOString()).toBe(serviceDate);
    });

    it('creates an order without client or company and does not query them', async () => {
      const bare = { ...record, clientId: null, companyId: null };
      orderModel.create.mockResolvedValue(bare);
      const dto = { serviceDate, status: 'SCHEDULED' };

      await expect(service.create(dto)).resolves.toEqual(bare);
      expect(clientModel.whereUnique).not.toHaveBeenCalled();
      expect(companyModel.whereUnique).not.toHaveBeenCalled();
      expect(orderModel.create).toHaveBeenCalledWith({
        ...dto,
        serviceDate: expect.any(Date),
      });
    });

    it('throws BadRequestException when the client does not exist', async () => {
      clientUnique.first.mockResolvedValue(null);

      await expect(
        service.create({ clientId, serviceDate, status: 'SCHEDULED' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderModel.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the company does not exist', async () => {
      companyUnique.first.mockResolvedValue(null);

      await expect(
        service.create({ companyId, serviceDate, status: 'SCHEDULED' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderModel.create).not.toHaveBeenCalled();
    });
  });

  it('lists all orders', async () => {
    orderModel.all.mockResolvedValue([record]);

    await expect(service.findAll()).resolves.toEqual([record]);
    expect(orderModel.all).toHaveBeenCalled();
    expect(orderModel.where).not.toHaveBeenCalled();
  });

  describe('findOne', () => {
    it('returns the order when it exists', async () => {
      unique.first.mockResolvedValue(record);
      await expect(service.findOne(id)).resolves.toEqual(record);
      expect(orderModel.whereUnique).toHaveBeenCalledWith({ id });
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);
      await expect(service.findOne(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('converts serviceDate to Date', async () => {
      const newDate = '2026-12-03T09:30:00.000Z';
      const updated = { ...record, serviceDate: new Date(newDate) };
      unique.first.mockResolvedValue(record);
      unique.update.mockResolvedValue(updated);

      await expect(
        service.update(id, { serviceDate: newDate }),
      ).resolves.toEqual(updated);
      expect(unique.update).toHaveBeenCalledWith({
        serviceDate: expect.any(Date),
      });
      const [data] = unique.update.mock.calls[0] as [{ serviceDate: Date }];
      expect(data.serviceDate.toISOString()).toBe(newDate);
    });

    it('does not touch serviceDate when the DTO omits it', async () => {
      const updated = { ...record, status: 'DONE' };
      unique.first.mockResolvedValue(record);
      unique.update.mockResolvedValue(updated);

      await expect(service.update(id, { status: 'DONE' })).resolves.toEqual(
        updated,
      );
      expect(clientModel.whereUnique).not.toHaveBeenCalled();
      expect(companyModel.whereUnique).not.toHaveBeenCalled();
      expect(unique.update).toHaveBeenCalledWith({ status: 'DONE' });
      const [data] = unique.update.mock.calls[0] as [object];
      expect(data).not.toHaveProperty('serviceDate');
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

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);

      await expect(
        service.update(id, { status: 'DONE' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(unique.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes the order', async () => {
      unique.first.mockResolvedValue(record);
      filtered.delete.mockResolvedValue(record);

      await expect(service.remove(id)).resolves.toEqual(record);
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
    orderModel.all.mockRejectedValue(new Error('connection refused'));
    await expect(service.findAll()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
