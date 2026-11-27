import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { REMINDER_TYPES, type ReminderType } from '../reminder-type.js';

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

  /** Tipo: `REMINDER` (por defecto) o `CONFIRMATION`. */
  @ApiProperty({ enum: REMINDER_TYPES, required: false })
  // No `@IsOptional()`: deja pasar `null` y la columna es `NOT NULL`.
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(REMINDER_TYPES)
  type?: ReminderType;
}
