import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CompanyService } from './company.service.js';

const { unique, filtered, companyModel, close } = vi.hoisted(() => {
  const unique = { first: vi.fn(), update: vi.fn() };
  const filtered = { first: vi.fn(), delete: vi.fn() };
  const companyModel = {
    create: vi.fn(),
    all: vi.fn(),
    whereUnique: vi.fn(() => unique),
    where: vi.fn(() => filtered),
  };
  return { unique, filtered, companyModel, close: vi.fn() };
});

vi.mock('../prisma/db.js', () => ({
  db: { orm: { public: { Company: companyModel } }, close },
}));

describe('CompanyService', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const otherId = 'a3d5e7f9-1b2c-4d6e-8f01-23456789abcd';
  const company = { id, name: 'Acme', active: true };
  let service: CompanyService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompanyService],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  afterEach(() => {
    expect(close).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it('creates a company when the name is free', async () => {
      filtered.first.mockResolvedValue(null);
      companyModel.create.mockResolvedValue(company);
      const dto = { name: 'Acme' };

      await expect(service.create(dto)).resolves.toEqual(company);
      expect(companyModel.where).toHaveBeenCalledWith({ name: 'Acme' });
      expect(companyModel.create).toHaveBeenCalledWith(dto);
    });

    it('throws ConflictException when the name already exists', async () => {
      filtered.first.mockResolvedValue({ ...company, id: otherId });

      await expect(service.create({ name: 'Acme' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(companyModel.create).not.toHaveBeenCalled();
    });
  });

  it('lists companies', async () => {
    companyModel.all.mockResolvedValue([company]);
    await expect(service.findAll()).resolves.toEqual([company]);
  });

  describe('findOne', () => {
    it('returns the company when it exists', async () => {
      unique.first.mockResolvedValue(company);
      await expect(service.findOne(id)).resolves.toEqual(company);
      expect(companyModel.whereUnique).toHaveBeenCalledWith({ id });
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);
      await expect(service.findOne(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the company', async () => {
      const updated = { ...company, active: false };
      unique.first.mockResolvedValue(company);
      unique.update.mockResolvedValue(updated);

      await expect(service.update(id, { active: false })).resolves.toEqual(
        updated,
      );
      expect(companyModel.where).not.toHaveBeenCalled();
      expect(unique.update).toHaveBeenCalledWith({ active: false });
    });

    it('allows keeping its own current name', async () => {
      unique.first.mockResolvedValue(company);
      filtered.first.mockResolvedValue(company);
      unique.update.mockResolvedValue(company);

      await expect(service.update(id, { name: 'Acme' })).resolves.toEqual(
        company,
      );
      expect(unique.update).toHaveBeenCalledWith({ name: 'Acme' });
    });

    it('throws ConflictException when another company has the name', async () => {
      unique.first.mockResolvedValue(company);
      filtered.first.mockResolvedValue({ id: otherId, name: 'Globex' });

      await expect(
        service.update(id, { name: 'Globex' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(unique.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);

      await expect(
        service.update(id, { active: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(unique.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes the company', async () => {
      unique.first.mockResolvedValue(company);
      filtered.delete.mockResolvedValue(company);

      await expect(service.remove(id)).resolves.toEqual(company);
      expect(companyModel.where).toHaveBeenCalledWith({ id });
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
    companyModel.all.mockRejectedValue(new Error('connection refused'));
    await expect(service.findAll()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
