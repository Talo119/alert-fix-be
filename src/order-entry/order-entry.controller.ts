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
import { OrderEntryService } from './order-entry.service.js';
import { CreateOrderEntryDto } from './dto/create-order-entry.dto.js';
import { UpdateOrderEntryDto } from './dto/update-order-entry.dto.js';

@ApiTags('order-entry')
@Controller('order-entry')
export class OrderEntryController {
  constructor(private readonly orderEntryService: OrderEntryService) {}

  /** Añade una línea (servicio + cantidad) a una orden. */
  @Post()
  create(@Body() createOrderEntryDto: CreateOrderEntryDto) {
    return this.orderEntryService.create(createOrderEntryDto);
  }

  /** Lista las líneas de orden. */
  @Get()
  findAll() {
    return this.orderEntryService.findAll();
  }

  /** Obtiene una línea de orden por id. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderEntryService.findOne(id);
  }

  /** Actualiza una línea de orden. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateOrderEntryDto: UpdateOrderEntryDto,
  ) {
    return this.orderEntryService.update(id, updateOrderEntryDto);
  }

  /** Elimina una línea de orden. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderEntryService.remove(id);
  }
}
