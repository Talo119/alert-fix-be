import { Test, TestingModule } from '@nestjs/testing';
import { ClientController } from './client.controller.js';
import { ClientService } from './client.service.js';

describe('ClientController', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const client = {
    id,
    name: 'Ana Pérez',
    email: 'ana@example.com',
    active: true,
  };
  const service = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  let controller: ClientController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientController],
      providers: [{ provide: ClientService, useValue: service }],
    }).compile();

    controller = module.get<ClientController>(ClientController);
  });

  it('create delegates the DTO', async () => {
    const dto = { name: 'Ana Pérez', email: 'ana@example.com' };
    service.create.mockResolvedValue(client);
    await expect(controller.create(dto)).resolves.toEqual(client);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('findAll delegates', async () => {
    service.findAll.mockResolvedValue([client]);
    await expect(controller.findAll()).resolves.toEqual([client]);
    expect(service.findAll).toHaveBeenCalledWith();
  });

  it('findOne delegates the id', async () => {
    service.findOne.mockResolvedValue(client);
    await expect(controller.findOne(id)).resolves.toEqual(client);
    expect(service.findOne).toHaveBeenCalledWith(id);
  });

  it('update delegates the id and DTO', async () => {
    const dto = { active: false };
    service.update.mockResolvedValue({ ...client, ...dto });
    await expect(controller.update(id, dto)).resolves.toEqual({
      ...client,
      ...dto,
    });
    expect(service.update).toHaveBeenCalledWith(id, dto);
  });

  it('remove delegates the id', async () => {
    service.remove.mockResolvedValue(client);
    await expect(controller.remove(id)).resolves.toEqual(client);
    expect(service.remove).toHaveBeenCalledWith(id);
  });
});
