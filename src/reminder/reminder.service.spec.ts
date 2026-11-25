import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReminderService } from './reminder.service.js';

const { unique, filtered, reminderModel, orderUnique, orderModel, close } =
  vi.hoisted(() => {
    const unique = { first: vi.fn(), update: vi.fn() };
    const filtered = { delete: vi.fn() };
    const reminderModel = {
      create: vi.fn(),
      all: vi.fn(),
      whereUnique: vi.fn(() => unique),
      where: vi.fn(() => filtered),
    };
    const orderUnique = { first: vi.fn() };
    const orderModel = { whereUnique: vi.fn(() => orderUnique) };
    return {
      unique,
      filtered,
      reminderModel,
      orderUnique,
      orderModel,
      close: vi.fn(),
    };
  });

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: { public: { Reminder: reminderModel, OrderHeader: orderModel } },
    close,
  },
}));

describe('ReminderService', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const orderId = 'a1b2c3d4-1234-4abc-8def-0123456789ab';
  const remindAt = '2027-12-01T14:00:00.000Z';
  const message = 'Recuerda despejar el área del equipo.';
  const order = { id: orderId, status: 'SCHEDULED' };
  const record = {
    id,
    orderId,
    message,
    remindAt: new Date(remindAt),
    status: 'PENDING',
    sentAt: null,
    lastError: null,
    externalMessageId: null,
  };
  let service: ReminderService;

  beforeEach(async () => {
    vi.resetAllMocks();
    reminderModel.whereUnique.mockReturnValue(unique);
    reminderModel.where.mockReturnValue(filtered);
    orderModel.whereUnique.mockReturnValue(orderUnique);
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReminderService],
    }).compile();

    service = module.get<ReminderService>(ReminderService);
  });

  afterEach(() => {
    expect(close).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it('creates a PENDING reminder with remindAt as Date', async () => {
      orderUnique.first.mockResolvedValue(order);
      reminderModel.create.mockResolvedValue(record);

      await expect(
        service.create({ orderId, message, remindAt }),
      ).resolves.toEqual(record);
      expect(orderModel.whereUnique).toHaveBeenCalledWith({ id: orderId });
      expect(reminderModel.create).toHaveBeenCalledWith({
        orderId,
        message,
        remindAt: new Date(remindAt),
        status: 'PENDING',
      });
    });

    it('creates a reminder without order and does not query it', async () => {
      const bare = { ...record, orderId: null };
      reminderModel.create.mockResolvedValue(bare);

      await expect(service.create({ message, remindAt })).resolves.toEqual(
        bare,
      );
      expect(orderModel.whereUnique).not.toHaveBeenCalled();
      expect(reminderModel.create).toHaveBeenCalledWith({
        message,
        remindAt: new Date(remindAt),
        status: 'PENDING',
      });
    });

    it('throws BadRequestException when the order does not exist', async () => {
      orderUnique.first.mockResolvedValue(null);

      await expect(
        service.create({ orderId, message, remindAt }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(reminderModel.create).not.toHaveBeenCalled();
    });
  });

  it('lists all reminders', async () => {
    reminderModel.all.mockResolvedValue([record]);

    await expect(service.findAll()).resolves.toEqual([record]);
    expect(reminderModel.all).toHaveBeenCalled();
    expect(reminderModel.where).not.toHaveBeenCalled();
  });

  describe('findOne', () => {
    it('returns the reminder when it exists', async () => {
      unique.first.mockResolvedValue(record);
      await expect(service.findOne(id)).resolves.toEqual(record);
      expect(reminderModel.whereUnique).toHaveBeenCalledWith({ id });
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);
      await expect(service.findOne(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the message without touching the order or remindAt', async () => {
      const updated = { ...record, message: 'Otro texto' };
      unique.first.mockResolvedValue(record);
      unique.update.mockResolvedValue(updated);

      await expect(
        service.update(id, { message: 'Otro texto' }),
      ).resolves.toEqual(updated);
      expect(orderModel.whereUnique).not.toHaveBeenCalled();
      expect(unique.update.mock.calls[0][0]).toStrictEqual({
        message: 'Otro texto',
      });
    });

    it('converts remindAt to Date', async () => {
      unique.first.mockResolvedValue(record);
      unique.update.mockResolvedValue(record);

      await service.update(id, { remindAt });
      expect(unique.update).toHaveBeenCalledWith({
        remindAt: new Date(remindAt),
      });
    });

    it('retries a FAILED reminder', async () => {
      unique.first.mockResolvedValue({ ...record, status: 'FAILED' });
      unique.update.mockResolvedValue(record);

      await expect(service.update(id, { status: 'PENDING' })).resolves.toEqual(
        record,
      );
      expect(unique.update).toHaveBeenCalledWith({ status: 'PENDING' });
    });

    it.each(['QUEUED', 'SENT'])(
      'throws ConflictException when it is %s',
      async (status) => {
        unique.first.mockResolvedValue({ ...record, status });

        await expect(service.update(id, { message })).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(unique.update).not.toHaveBeenCalled();
      },
    );

    it('throws BadRequestException when the order does not exist', async () => {
      unique.first.mockResolvedValue(record);
      orderUnique.first.mockResolvedValue(null);

      await expect(service.update(id, { orderId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(unique.update).not.toHaveBeenCalled();
    });

    it('unassigns the order with orderId null', async () => {
      const updated = { ...record, orderId: null };
      unique.first.mockResolvedValue(record);
      unique.update.mockResolvedValue(updated);

      await expect(
        service.update(id, { orderId: null as unknown as undefined }),
      ).resolves.toEqual(updated);
      expect(orderModel.whereUnique).not.toHaveBeenCalled();
      expect(unique.update).toHaveBeenCalledWith({ orderId: null });
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);

      await expect(service.update(id, { message })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(unique.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it.each(['PENDING', 'QUEUED'])('removes a %s reminder', async (status) => {
      const current = { ...record, status };
      unique.first.mockResolvedValue(current);
      filtered.delete.mockResolvedValue(current);

      await expect(service.remove(id)).resolves.toEqual(current);
      expect(reminderModel.where).toHaveBeenCalledWith({ id });
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
    reminderModel.all.mockRejectedValue(new Error('connection refused'));
    await expect(service.findAll()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
