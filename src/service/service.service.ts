import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { db } from '../prisma/db.js';
import { CreateServiceDto } from './dto/create-service.dto.js';
import { UpdateServiceDto } from './dto/update-service.dto.js';

@Injectable()
export class ServiceService {
  private readonly logger = new Logger(ServiceService.name);

  async create(createServiceDto: CreateServiceDto) {
    try {
      this.assertFrequency(createServiceDto);
      if (createServiceDto.companyId) {
        await this.assertCompanyExists(createServiceDto.companyId);
      }
      const service = await db.orm.public.Service.create(createServiceDto);
      this.logger.log(`Created service ${service.id}`);
      return service;
    } catch (error) {
      this.handleError('Failed to create service', error);
    }
  }

  async findAll(companyId: string) {
    try {
      return await db.orm.public.Service.where({
        active: true,
        companyId,
      }).all();
    } catch (error) {
      this.handleError('Failed to fetch services', error);
    }
  }

  async findOne(id: string) {
    try {
      const service = await db.orm.public.Service.whereUnique({ id }).first();
      if (!service) throw new NotFoundException(`Service ${id} not found`);
      return service;
    } catch (error) {
      this.handleError(`Failed to fetch service ${id}`, error);
    }
  }

  async update(id: string, updateServiceDto: UpdateServiceDto) {
    try {
      const existing = await this.findOne(id);
      // Lo que el DTO no trae (`undefined`) se queda como está guardado.
      const {
        frequencyValue = existing.frequencyValue,
        frequencyUnit = existing.frequencyUnit,
      } = updateServiceDto;
      this.assertFrequency({ frequencyValue, frequencyUnit });
      if (updateServiceDto.companyId) {
        await this.assertCompanyExists(updateServiceDto.companyId);
      }
      const service = await db.orm.public.Service.whereUnique({ id }).update(
        updateServiceDto,
      );
      this.logger.log(`Updated service ${id}`);
      return service;
    } catch (error) {
      this.handleError(`Failed to update service ${id}`, error);
    }
  }

  async remove(id: string) {
    try {
      await this.findOne(id);
      const service = await db.orm.public.Service.where({ id }).delete();
      this.logger.log(`Removed service ${id}`);
      return service;
    } catch (error) {
      this.handleError(`Failed to remove service ${id}`, error);
    }
  }

  /** `frequencyValue` y `frequencyUnit` van los dos o ninguno (spec 12). */
  private assertFrequency({
    frequencyValue,
    frequencyUnit,
  }: {
    frequencyValue?: number | null;
    frequencyUnit?: string | null;
  }) {
    if ((frequencyValue == null) !== (frequencyUnit == null)) {
      throw new BadRequestException(
        'frequencyValue and frequencyUnit must be set together',
      );
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
