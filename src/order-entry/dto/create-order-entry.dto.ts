import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateOrderEntryDto {
  /** Orden (`OrderHeader`) a la que pertenece la línea. */
  @IsOptional()
  @IsUUID()
  orderId?: string;

  /** Servicio del catálogo (`Service`) que se presta. */
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  /** Cantidad del servicio. Entero, mínimo 1. */
  @IsInt()
  @Min(1)
  quantity: number;
}
