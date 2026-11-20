import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/** Una línea de la orden. Sin `orderId`: lo asigna el service. */
export class OrderHeaderEntryDto {
  /** Servicio del catálogo (`Service`) que se presta. */
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  /** Cantidad del servicio. Entero, mínimo 1. */
  @IsInt()
  @Min(1)
  quantity: number;
}
