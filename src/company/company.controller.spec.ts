import { Test, TestingModule } from '@nestjs/testing';
import { CompanyController } from './company.controller.js';
import { CompanyService } from './company.service.js';

describe('CompanyController', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const company = { id, name: 'Acme', active: true };
  const service = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
  let controller: CompanyController;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CompanyController],
      providers: [{ provide: CompanyService, useValue: service }],
    }).compile();

    controller = module.get<CompanyController>(CompanyController);
  });

  it('create delegates the DTO', async () => {
    const dto = { name: 'Acme' };
    service.create.mockResolvedValue(company);
    await expect(controller.create(dto)).resolves.toEqual(company);
    expect(service.create).toHaveBeenCalledWith(dto);
  });

  it('findAll delegates', async () => {
    service.findAll.mockResolvedValue([company]);
    await expect(controller.findAll()).resolves.toEqual([company]);
    expect(service.findAll).toHaveBeenCalledWith();
  });

  it('findOne delegates the id', async () => {
    service.findOne.mockResolvedValue(company);
    await expect(controller.findOne(id)).resolves.toEqual(company);
    expect(service.findOne).toHaveBeenCalledWith(id);
  });

  it('update delegates the id and DTO', async () => {
    const dto = { active: false };
    service.update.mockResolvedValue({ ...company, ...dto });
    await expect(controller.update(id, dto)).resolves.toEqual({
      ...company,
      ...dto,
    });
    expect(service.update).toHaveBeenCalledWith(id, dto);
  });

  it('remove delegates the id', async () => {
    service.remove.mockResolvedValue(company);
    await expect(controller.remove(id)).resolves.toEqual(company);
    expect(service.remove).toHaveBeenCalledWith(id);
  });
});
