import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientService } from './client.service.js';

const { unique, filtered, clientModel, companyUnique, companyModel, close } =
  vi.hoisted(() => {
    const unique = { first: vi.fn(), update: vi.fn() };
    const filtered = { first: vi.fn(), all: vi.fn(), delete: vi.fn() };
    const clientModel = {
      create: vi.fn(),
      whereUnique: vi.fn(() => unique),
      where: vi.fn(() => filtered),
    };
    const companyUnique = { first: vi.fn() };
    const companyModel = { whereUnique: vi.fn(() => companyUnique) };
    return {
      unique,
      filtered,
      clientModel,
      companyUnique,
      companyModel,
      close: vi.fn(),
    };
  });

vi.mock('../prisma/db.js', () => ({
  db: {
    orm: { public: { Client: clientModel, Company: companyModel } },
    close,
  },
}));

describe('ClientService', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const otherId = 'a3d5e7f9-1b2c-4d6e-8f01-23456789abcd';
  const companyId = 'c0ffee00-1234-4abc-8def-0123456789ab';
  const company = { id: companyId, name: 'Acme', active: true };
  const client = {
    id,
    name: 'Ana Pérez',
    email: 'ana@example.com',
    phoneNumber: '+50688887777',
    companyId,
    active: true,
  };
  let service: ClientService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ClientService],
    }).compile();

    service = module.get<ClientService>(ClientService);
  });

  afterEach(() => {
    expect(close).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it('creates a client when the email is free and the company exists', async () => {
      filtered.first.mockResolvedValue(null);
      companyUnique.first.mockResolvedValue(company);
      clientModel.create.mockResolvedValue(client);
      const dto = {
        name: 'Ana Pérez',
        email: 'ana@example.com',
        phoneNumber: '+50688887777',
        companyId,
      };

      await expect(service.create(dto)).resolves.toEqual(client);
      expect(clientModel.where).toHaveBeenCalledWith({
        email: 'ana@example.com',
      });
      expect(companyModel.whereUnique).toHaveBeenCalledWith({ id: companyId });
      expect(clientModel.create).toHaveBeenCalledWith(dto);
    });

    it('creates a client without a company and does not query Company', async () => {
      filtered.first.mockResolvedValue(null);
      clientModel.create.mockResolvedValue({ ...client, companyId: null });
      const dto = { name: 'Ana Pérez', email: 'ana@example.com' };

      await expect(service.create(dto)).resolves.toEqual({
        ...client,
        companyId: null,
      });
      expect(companyModel.whereUnique).not.toHaveBeenCalled();
      expect(clientModel.create).toHaveBeenCalledWith(dto);
    });

    it('throws BadRequestException when the company does not exist', async () => {
      filtered.first.mockResolvedValue(null);
      companyUnique.first.mockResolvedValue(null);

      await expect(
        service.create({ name: 'X', email: 'x@example.com', companyId }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(clientModel.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the email already exists', async () => {
      filtered.first.mockResolvedValue({ ...client, id: otherId });

      await expect(
        service.create({ name: 'Otra', email: 'ana@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(clientModel.create).not.toHaveBeenCalled();
    });
  });

  it('lists only active clients', async () => {
    filtered.all.mockResolvedValue([client]);

    await expect(service.findAll()).resolves.toEqual([client]);
    expect(clientModel.where).toHaveBeenCalledWith({ active: true });
    expect(filtered.all).toHaveBeenCalled();
  });

  describe('findOne', () => {
    it('returns the client when it exists', async () => {
      unique.first.mockResolvedValue(client);
      await expect(service.findOne(id)).resolves.toEqual(client);
      expect(clientModel.whereUnique).toHaveBeenCalledWith({ id });
    });

    it('throws NotFoundException when missing', async () => {
      unique.first.mockResolvedValue(null);
      await expect(service.findOne(id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates the client', async () => {
      const updated = { ...client, active: false };
      unique.first.mockResolvedValue(client);
      unique.update.mockResolvedValue(updated);

      await expect(service.update(id, { active: false })).resolves.toEqual(
        updated,
      );
      expect(clientModel.where).not.toHaveBeenCalled();
      expect(companyModel.whereUnique).not.toHaveBeenCalled();
      expect(unique.update).toHaveBeenCalledWith({ active: false });
    });

    it('allows keeping its own current email', async () => {
      unique.first.mockResolvedValue(client);
      filtered.first.mockResolvedValue(client);
      unique.update.mockResolvedValue(client);

      await expect(
        service.update(id, { email: 'ana@example.com' }),
      ).resolves.toEqual(client);
      expect(unique.update).toHaveBeenCalledWith({ email: 'ana@example.com' });
    });

    it('throws ConflictException when another client has the email', async () => {
      unique.first.mockResolvedValue(client);
      filtered.first.mockResolvedValue({
        id: otherId,
        email: 'otro@example.com',
      });

      await expect(
        service.update(id, { email: 'otro@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(unique.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the company does not exist', async () => {
      unique.first.mockResolvedValue(client);
      companyUnique.first.mockResolvedValue(null);

      await expect(service.update(id, { companyId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
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
    it('removes the client', async () => {
      unique.first.mockResolvedValue(client);
      filtered.delete.mockResolvedValue(client);

      await expect(service.remove(id)).resolves.toEqual(client);
      expect(clientModel.where).toHaveBeenCalledWith({ id });
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
