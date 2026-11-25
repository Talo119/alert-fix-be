import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { ReminderStatus } from '../reminder-status.js';
import { CreateReminderDto } from './create-reminder.dto.js';

export class UpdateReminderDto extends PartialType(CreateReminderDto, {
  skipNullProperties: false,
}) {
  /** Solo `PENDING`: reintenta un recordatorio `FAILED` en el siguiente cron. */
  @ApiProperty({ enum: [ReminderStatus.PENDING], required: false })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn([ReminderStatus.PENDING])
  status?: typeof ReminderStatus.PENDING;
}
