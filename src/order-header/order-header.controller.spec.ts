import { Test, TestingModule } from '@nestjs/testing';
import { OrderHeaderController } from './order-header.controller.js';
import { OrderHeaderService } from './order-header.service.js';

describe('OrderHeaderController', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const record = {
    id,
    serviceDate: new Date('2026-12-01T14:00:00.000Z'),
    status: 'SCHEDULED',
  };
  const service = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  let controller: OrderHeaderController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrderHeaderController],
      providers: [{ provide: OrderHeaderService, useValue: service }],
    }).compile();

    controller = module.get<OrderHeaderController>(OrderHeaderController);
  });

  it('create delegates the DTO', async () => {
    const dto = {
      serviceDate: '2026-12-01T14:00:00.000Z',
      status: 'SCHEDULED',
      entries: [{ quantity: 2 }],
    };
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
    const dto = { status: 'DONE' };
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
