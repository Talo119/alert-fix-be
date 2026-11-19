import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

@Injectable()
export class CompanyService {
  private readonly logger = new Logger(CompanyService.name);

  async create(createCompanyDto: CreateCompanyDto) {
    try {
      await this.assertNameAvailable(createCompanyDto.name);
      const company = await db.orm.public.Company.create(createCompanyDto);
      this.logger.log(`Created company ${company.id}`);
      return company;
    } catch (error) {
      this.handleError('Failed to create company', error);
    }
  }

  async findAll() {
    try {
      return await db.orm.public.Company.all();
    } catch (error) {
      this.handleError('Failed to fetch companies', error);
    }
  }

  async findOne(id: string) {
    try {
      const company = await db.orm.public.Company.whereUnique({ id }).first();
      if (!company) throw new NotFoundException(`Company ${id} not found`);
      return company;
    } catch (error) {
      this.handleError(`Failed to fetch company ${id}`, error);
    }
  }

  async update(id: string, updateCompanyDto: UpdateCompanyDto) {
    try {
      await this.findOne(id);
      if (updateCompanyDto.name !== undefined) {
        await this.assertNameAvailable(updateCompanyDto.name, id);
      }
      const company = await db.orm.public.Company.whereUnique({ id }).update(
        updateCompanyDto,
      );
      this.logger.log(`Updated company ${id}`);
      return company;
    } catch (error) {
      this.handleError(`Failed to update company ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const company = await db.orm.public.Company.where({ id }).delete();
      this.logger.log(`Removed company ${id}`);
      return company;
    } catch (error) {
      this.handleError(`Failed to remove company ${id}`, error);
    }
  }

  private async assertNameAvailable(name: string, exceptId?: string) {
    const existing = await db.orm.public.Company.where({ name }).first();
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(`Company name "${name}" already exists`);
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
