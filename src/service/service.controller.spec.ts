import { Test, TestingModule } from '@nestjs/testing';
import { ServiceController } from './service.controller.js';
import { ServiceService } from './service.service.js';

describe('ServiceController', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const record = { id, name: 'Cambio de filtro', active: true };
  const service = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  let controller: ServiceController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ServiceController],
      providers: [{ provide: ServiceService, useValue: service }],
    }).compile();

    controller = module.get<ServiceController>(ServiceController);
  });

  it('create delegates the DTO', async () => {
    const dto = { name: 'Cambio de filtro' };
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
    const dto = { active: false };
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
