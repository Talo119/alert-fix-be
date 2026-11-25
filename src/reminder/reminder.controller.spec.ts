import { Test, TestingModule } from '@nestjs/testing';
import { ReminderController } from './reminder.controller.js';
import { ReminderService } from './reminder.service.js';

describe('ReminderController', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const orderId = 'a1b2c3d4-1234-4abc-8def-0123456789ab';
  const message = 'Recuerda despejar el área del equipo.';
  const remindAt = '2027-12-01T14:00:00.000Z';
  const record = { id, orderId, message, remindAt, status: 'PENDING' };
  const service = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  let controller: ReminderController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReminderController],
      providers: [{ provide: ReminderService, useValue: service }],
    }).compile();

    controller = module.get<ReminderController>(ReminderController);
  });

  it('create delegates the DTO', async () => {
    const dto = { orderId, message, remindAt };
    service.create.mockResolvedValue(record);
    await expect(controller.create(dto)).resolves.toEqual(record);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('findAll delegates', async () => {
    service.findAll.mockResolvedValue([record]);
    await expect(controller.findAll()).resolves.toEqual([record]);
    expect(service.findAll).toHaveBeenCalledWith();
  });

  it('findOne delegates the id', async () => {
    service.findOne.mockResolvedValue(record);
    await expect(controller.findOne(id)).resolves.toEqual(record);
    expect(service.findOne).toHaveBeenCalledWith(id);
  });

  it('update delegates the id and DTO', async () => {
    const dto = { message: 'Otro texto' };
    service.update.mockResolvedValue({ ...record, ...dto });
    await expect(controller.update(id, dto)).resolves.toEqual({
      ...record,
      ...dto,
    });
    expect(service.update).toHaveBeenCalledWith(id, dto);
  });

  it('remove delegates the id', async () => {
    service.remove.mockResolvedValue(record);
    await expect(controller.remove(id)).resolves.toEqual(record);
    expect(service.remove).toHaveBeenCalledWith(id);
  });
});
