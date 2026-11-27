import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { ORDER_STATUSES, type OrderStatus } from '../order-status.js';
import { OrderHeaderEntryDto } from './order-header-entry.dto.js';

export class CreateOrderHeaderDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  /** Fecha y hora del servicio, en ISO 8601 (p. ej. `2026-12-01T14:00:00.000Z`). */
  @IsDateString()
  serviceDate: string;

  /** Estado de la orden: `OPEN`, `COMPLETED` o `CANCELLED`. */
  @ApiProperty({ enum: ORDER_STATUSES })
  @IsIn(ORDER_STATUSES)
  status: OrderStatus;

  /** Líneas de la orden (servicio + cantidad). Al menos una. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderHeaderEntryDto)
  entries: OrderHeaderEntryDto[];
}
