import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateReminderDto {
  /** Orden (`OrderHeader`) sobre la que se avisa al cliente. */
  @IsOptional()
  @IsUUID()
  orderId?: string;

  /** Texto del recordatorio: parámetro `{{3}}` de la plantilla de WhatsApp. */
  @IsString()
  @IsNotEmpty()
  message: string;

  /** Cuándo enviarlo, en ISO 8601 (p. ej. `2026-11-30T14:00:00.000Z`). El cron es diario: cuenta el día, no la hora. */
  @IsDateString()
  remindAt: string;
}
