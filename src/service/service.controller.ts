import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ServiceService } from './service.service.js';
import { CreateServiceDto } from './dto/create-service.dto.js';
import { UpdateServiceDto } from './dto/update-service.dto.js';

@ApiTags('service')
@Controller('service')
export class ServiceController {
  constructor(private readonly serviceService: ServiceService) {}

  /** Crea un servicio. */
  @Post()
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.serviceService.create(createServiceDto);
  }

  /** Lista los servicios activos. */
  @Get()
  findAll() {
    return this.serviceService.findAll();
  }

  /** Obtiene un servicio por id (incluidos los inactivos). */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.serviceService.findOne(id);
  }

  /** Actualiza un servicio. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServiceDto: UpdateServiceDto,
  ) {
    return this.serviceService.update(id, updateServiceDto);
  }

  /** Elimina un servicio. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.serviceService.remove(id);
  }
}
