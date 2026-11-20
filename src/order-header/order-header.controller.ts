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
import { OrderHeaderService } from './order-header.service.js';
import { CreateOrderHeaderDto } from './dto/create-order-header.dto.js';
import { UpdateOrderHeaderDto } from './dto/update-order-header.dto.js';

@ApiTags('order-header')
@Controller('order-header')
export class OrderHeaderController {
  constructor(private readonly orderHeaderService: OrderHeaderService) {}

  /** Crea una orden con sus líneas, en una sola transacción. */
  @Post()
  create(@Body() createOrderHeaderDto: CreateOrderHeaderDto) {
    return this.orderHeaderService.create(createOrderHeaderDto);
  }

  /** Lista las órdenes de mantenimiento. */
  @Get()
  findAll() {
    return this.orderHeaderService.findAll();
  }

  /** Obtiene una orden por id, con sus líneas. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderHeaderService.findOne(id);
  }

  /** Actualiza una orden; si se envía `entries`, reemplaza todas sus líneas. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateOrderHeaderDto: UpdateOrderHeaderDto,
  ) {
    return this.orderHeaderService.update(id, updateOrderHeaderDto);
  }

  /** Elimina una orden. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderHeaderService.remove(id);
  }
}
