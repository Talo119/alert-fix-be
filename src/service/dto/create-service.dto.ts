import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { FREQUENCY_UNITS, type FrequencyUnit } from '../frequency-unit.js';

export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Cada cuántas unidades se repite el servicio. Va junto con `frequencyUnit`. */
  @IsOptional()
  @IsInt()
  @Min(1)
  frequencyValue?: number;

  /** Unidad de la frecuencia: `DAY` o `MONTH`. Va junto con `frequencyValue`. */
  @ApiProperty({ enum: FREQUENCY_UNITS, required: false })
  @IsOptional()
  @IsIn(FREQUENCY_UNITS)
  frequencyUnit?: FrequencyUnit;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
