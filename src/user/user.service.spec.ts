import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service.js';

const { unique, userModel, close } = vi.hoisted(() => {
  const unique = {
    first: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const userModel = {
    create: vi.fn(),
    all: vi.fn(),
    whereUnique: vi.fn(() => unique),
  };
  return { unique, userModel, close: vi.fn() };
});

vi.mock('../prisma/db.js', () => ({
  db: { orm: { public: { User: userModel } }, close },
}));

describe('UserService', () => {
  const id = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';
  const user = { id, email: 'a@b.com' };
  let service: UserService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [UserService],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('creates a user', async () => {
    userModel.create.mockResolvedValue(user);
    const dto = {
      email: 'a@b.com',
      username: 'a',
      name: 'A',
      phoneNumber: '1',
      companyId: id,
    };
    await expect(service.create(dto)).resolves.toEqual(user);
    expect(userModel.create).toHaveBeenCalledWith(dto);
  });

  it('lists users', async () => {
    userModel.all.mockResolvedValue([user]);
    await expect(service.findAll()).resolves.toEqual([user]);
  });

  it.each([
    ['findOne', 'first'],
    ['update', 'update'],
    ['remove', 'delete'],
  ] as const)('%s returns the user when it exists', async (method, query) => {
    unique[query].mockResolvedValue(user);
    await expect(service[method](id, {})).resolves.toEqual(user);
    expect(userModel.whereUnique).toHaveBeenCalledWith({ id });
  });

  it.each([
    ['findOne', 'first'],
    ['update', 'update'],
    ['remove', 'delete'],
  ] as const)(
    '%s throws NotFoundException when missing',
    async (method, query) => {
      unique[query].mockResolvedValue(null);
      await expect(service[method](id, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it('propagates database errors instead of turning them into 404', async () => {
    const dbError = new Error('connection refused');
    unique.first.mockRejectedValue(dbError);
    await expect(service.findOne(id)).rejects.toBe(dbError);
  });

  it('never closes the shared db instance', async () => {
    unique.first.mockResolvedValue(user);
    userModel.all.mockResolvedValue([user]);
    await service.findOne(id);
    await service.findAll();
    expect(close).not.toHaveBeenCalled();
  });
});
