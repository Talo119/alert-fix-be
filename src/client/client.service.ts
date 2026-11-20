import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

@Injectable()
export class ClientService {
  private readonly logger = new Logger(ClientService.name);

  async create(createClientDto: CreateClientDto) {
    try {
      await this.assertEmailAvailable(createClientDto.email);
      if (createClientDto.companyId) {
        await this.assertCompanyExists(createClientDto.companyId);
      }
      const client = await db.orm.public.Client.create(createClientDto);
      this.logger.log(`Created client ${client.id}`);
      return client;
    } catch (error) {
      this.handleError('Failed to create client', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.Client.where({ active: true }).all();
    } catch (error) {
      this.handleError('Failed to fetch clients', error);
    }
  }

  async findOne(id: string) {
    try {
      const client = await db.orm.public.Client.whereUnique({ id }).first();
      if (!client) throw new NotFoundException(`Client ${id} not found`);
      return client;
    } catch (error) {
      this.handleError(`Failed to fetch client ${id}`, error);
    }
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    try {
      await this.findOne(id);
      if (updateClientDto.email !== undefined) {
        await this.assertEmailAvailable(updateClientDto.email, id);
      }
      if (updateClientDto.companyId) {
        await this.assertCompanyExists(updateClientDto.companyId);
      }
      const client = await db.orm.public.Client.whereUnique({ id }).update(
        updateClientDto,
      );
      this.logger.log(`Updated client ${id}`);
      return client;
    } catch (error) {
      this.handleError(`Failed to update client ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const client = await db.orm.public.Client.where({ id }).delete();
      this.logger.log(`Removed client ${id}`);
      return client;
    } catch (error) {
      this.handleError(`Failed to remove client ${id}`, error);
    }
  }

  private async assertEmailAvailable(email: string, exceptId?: string) {
    const existing = await db.orm.public.Client.where({ email }).first();
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`Client email "${email}" already exists`);
    }
  }

  private async assertCompanyExists(companyId: string) {
    const company = await db.orm.public.Company.whereUnique({
      id: companyId,
    }).first();
    if (!company) {
      throw new BadRequestException(`Company ${companyId} does not exist`);
    }
  }

  private handleError(message: string, error: unknown): never {
    if (error instanceof HttpException) throw error;
    this.logger.error(
      message,
      error instanceof Error ? error.message : String(error),
    );
    throw new InternalServerErrorException(message);
  }
}
