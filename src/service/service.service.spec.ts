import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceService } from './service.service.js';

const { unique, filtered, serviceModel, companyUnique, companyModel, close } =
  vi.hoisted(() => {
    const unique = { first: vi.fn(), update: vi.fn() };
    const filtered = { all: vi.fn(), delete: vi.fn() };
    const serviceModel = {
      create: vi.fn(),
      whereUnique: vi.fn(() => unique),
      where: vi.fn(() => filtered),
    };
    const companyUnique = { first: vi.fn() };
    const companyModel = { whereUnique: vi.fn(() => companyUnique) };
    return {
      unique,
      filtered,
      serviceModel,
      companyUnique,
      companyModel,
      close: vi.fn(),
    };
  });

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: { public: { Service: serviceModel, Company: companyModel } },
    close,
  },
}));

describe('ServiceService', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const companyId = 'c0ffee00-1234-4abc-8def-0123456789ab';
  const company = { id: companyId, name: 'Acme', active: true };
  const record = {
    id,
    name: 'Cambio de filtro',
    description: 'Filtro de agua, incluye repuesto',
    companyId,
    active: true,
  };
  let service: ServiceService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ServiceService],
    }).compile();

    service = module.get<ServiceService>(ServiceService);
  });

  afterEach(() => {
    expect(close).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it('creates a service when the company exists', async () => {
      companyUnique.first.mockResolvedValue(company);
      serviceModel.create.mockResolvedValue(record);
      const dto = {
        name: 'Cambio de filtro',
        description: 'Filtro de agua, incluye repuesto',
        companyId,
      };

      await expect(service.create(dto)).resolves.toEqual(record);
      expect(companyModel.whereUnique).toHaveBeenCalledWith({ id: companyId });
      expect(serviceModel.create).toHaveBeenCalledWith(dto);
    });

    it('creates a service without a company and does not query Company', async () => {
      serviceModel.create.mockResolvedValue({ ...record, companyId: null });
      const dto = { name: 'Cambio de filtro' };

      await expect(service.create(dto)).resolves.toEqual({
        ...record,
        companyId: null,
      });
      expect(companyModel.whereUnique).not.toHaveBeenCalled();
      expect(serviceModel.create).toHaveBeenCalledWith(dto);
    });

    it('creates a service with a frequency', async () => {
      const dto = {
        name: 'Limpieza de A/C',
        frequencyValue: 3,
        frequencyUnit: 'MONTH' as const,
      };
      serviceModel.create.mockResolvedValue({ ...record, ...dto });

      await service.create(dto);
      expect(serviceModel.create).toHaveBeenCalledWith(dto);
    });

    it.each([{ frequencyValue: 3 }, { frequencyUnit: 'DAY' as const }])(
      'throws BadRequestException with only one frequency field: %j',
      async (frequency) => {
        await expect(
          service.create({ name: 'X', ...frequency }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(serviceModel.create).not.toHaveBeenCalled();
      },
    );

    it('throws BadRequestException when the company does not exist', async () => {
      companyUnique.first.mockResolvedValue(null);

      await expect(
        service.create({ name: 'X', companyId }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(serviceModel.create).not.toHaveBeenCalled();
    });
  });

  it('lists only active services', async () => {
    filtered.all.mockResolvedValue([record]);

    await expect(service.findAll()).resolves.toEqual([record]);
    expect(serviceModel.where).toHaveBeenCalledWith({ active: true });
    expect(filtered.all).toHaveBeenCalled();
  });

  describe('findOne', () => {
    it('returns the service when it exists', async () => {
      unique.first.mockResolvedValue(record);
      await expect(service.findOne(id)).resolves.toEqual(record);
      expect(serviceModel.whereUnique).toHaveBeenCalledWith({ id });
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);
      await expect(service.findOne(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the service', async () => {
      const updated = { ...record, active: false };
      unique.first.mockResolvedValue(record);
      unique.update.mockResolvedValue(updated);

      await expect(service.update(id, { active: false })).resolves.toEqual(
        updated,
      );
      expect(companyModel.whereUnique).not.toHaveBeenCalled();
      expect(unique.update).toHaveBeenCalledWith({ active: false });
    });

    it('throws BadRequestException when the company does not exist', async () => {
      unique.first.mockResolvedValue(record);
      companyUnique.first.mockResolvedValue(null);

      await expect(service.update(id, { companyId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(unique.update).not.toHaveBeenCalled();
    });

    describe('frequency', () => {
      const withFrequency = {
        ...record,
        frequencyValue: 3,
        frequencyUnit: 'MONTH',
      };

      it('changes only the value when the record already has a unit', async () => {
        unique.first.mockResolvedValue(withFrequency);
        unique.update.mockResolvedValue({
          ...withFrequency,
          frequencyValue: 6,
        });

        await service.update(id, { frequencyValue: 6 });
        expect(unique.update).toHaveBeenCalledWith({ frequencyValue: 6 });
      });

      it('throws BadRequestException when the update leaves it incomplete', async () => {
        unique.first.mockResolvedValue(withFrequency);
        // `@IsOptional()` lets `null` through, although the DTO type does not.
        const body = { frequencyUnit: null } as unknown as {
          frequencyUnit?: 'DAY';
        };

        await expect(service.update(id, body)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(unique.update).not.toHaveBeenCalled();
      });

      it('throws BadRequestException when setting only the value on a record without frequency', async () => {
        unique.first.mockResolvedValue({
          ...record,
          frequencyValue: null,
          frequencyUnit: null,
        });

        await expect(
          service.update(id, { frequencyValue: 3 }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(unique.update).not.toHaveBeenCalled();
      });

      it('removes the frequency when both fields are null', async () => {
        unique.first.mockResolvedValue(withFrequency);
        unique.update.mockResolvedValue({
          ...record,
          frequencyValue: null,
          frequencyUnit: null,
        });
        const body = {
          frequencyValue: null,
          frequencyUnit: null,
        } as unknown as {
          frequencyValue?: number;
        };

        await service.update(id, body);
        expect(unique.update).toHaveBeenCalledWith({
          frequencyValue: null,
          frequencyUnit: null,
        });
      });
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
    it('removes the service', async () => {
      unique.first.mockResolvedValue(record);
      filtered.delete.mockResolvedValue(record);

      await expect(service.remove(id)).resolves.toEqual(record);
      expect(serviceModel.where).toHaveBeenCalledWith({ id });
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
    filtered.all.mockRejectedValue(new Error('connection refused'));
    await expect(service.findAll()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
