import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

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
}
