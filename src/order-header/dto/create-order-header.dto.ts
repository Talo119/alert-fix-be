import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
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

  /** Estado de la orden. Valor libre por ahora (sin enum). */
  @IsString()
  @IsNotEmpty()
  status: string;

  /** Líneas de la orden (servicio + cantidad). Al menos una. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderHeaderEntryDto)
  entries: OrderHeaderEntryDto[];
}
