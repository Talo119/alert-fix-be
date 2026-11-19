import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { db } from '../prisma/db.js';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  async create(createUserDto: CreateUserDto) {
    const user = await db.orm.public.User.create(createUserDto);
    this.logger.log(`Created user ${user.id}`);
    return user;
  }

  findAll() {
    return db.orm.public.User.all();
  }

  async findOne(id: string) {
    const user = await db.orm.public.User.whereUnique({ id }).first();
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await db.orm.public.User.whereUnique({ id }).update(
      updateUserDto,
    );
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    this.logger.log(`Updated user ${id}`);
    return user;
  }

  async remove(id: string) {
    const user = await db.orm.public.User.whereUnique({ id }).delete();
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    this.logger.log(`Removed user ${id}`);
    return user;
  }
}
