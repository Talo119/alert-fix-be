import { Test, TestingModule } from '@nestjs/testing';
import { OrderEntryController } from './order-entry.controller.js';
import { OrderEntryService } from './order-entry.service.js';

describe('OrderEntryController', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const orderId = 'a1b2c3d4-1234-4abc-8def-0123456789ab';
  const serviceId = 'c0ffee00-1234-4abc-8def-0123456789ab';
  const record = { id, orderId, serviceId, quantity: 2 };
  const service = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  let controller: OrderEntryController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrderEntryController],
      providers: [{ provide: OrderEntryService, useValue: service }],
    }).compile();

    controller = module.get<OrderEntryController>(OrderEntryController);
  });

  it('create delegates the DTO', async () => {
    const dto = { orderId, serviceId, quantity: 2 };
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
    const dto = { quantity: 3 };
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
