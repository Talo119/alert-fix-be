import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { db } from '../prisma/db.js';

@Injectable()
export class UserService {
  private readonly logger = new Logger('UserService');
  async create(createUserDto: CreateUserDto) {
    try {
      this.logger.log(`Creating user with ID: ${createUserDto.id}`);
      const user = await db.orm.public.User.create(createUserDto);
      await db.close();
      return user;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Failed to create user', error.message);
      } else {
        this.logger.error('Failed to create user', String(error));
      }
      throw new NotFoundException('User not found');
    }
  }

  async findAll() {
    try {
      this.logger.log('Fetching all users');
      const users = await db.orm.public.User.all();
      await db.close();
      return users;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Failed to fetch users', error.message);
      } else {
        this.logger.error('Failed to fetch users', String(error));
      }
      throw new NotFoundException('Users not found');
    }
  }

  async findOne(id: string) {
    try {
      this.logger.log(`Fetching user with ID: ${id}`);
      const user = await db.orm.public.User.whereUnique({ id }).first();
      await db.close();
      if (!user) {
        throw new NotFoundException('User not found');
      }
      return user;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Failed to fetch user', error.message);
      } else {
        this.logger.error('Failed to fetch user', String(error));
      }
      throw new NotFoundException('User not found');
    }
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      this.logger.log(`Updating user with ID: ${id}`);
      const user = await db.orm.public.User.whereUnique({ id }).update(
        updateUserDto,
      );
      await db.close();
      return user;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Failed to update user', error.message);
      } else {
        this.logger.error('Failed to update user', String(error));
      }
      throw new NotFoundException('User not found');
    }
  }

  async remove(id: string) {
    try {
      this.logger.log(`Removing user with ID: ${id}`);
      const user = await db.orm.public.User.where({ id }).delete();
      await db.close();
      return user;
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Failed to remove user', error.message);
      } else {
        this.logger.error('Failed to remove user', String(error));
      }
      throw new NotFoundException('User not found');
    }
  }
}
