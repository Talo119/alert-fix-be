import { PartialType } from '@nestjs/swagger';
import { CreateOrderEntryDto } from './create-order-entry.dto.js';

export class UpdateOrderEntryDto extends PartialType(CreateOrderEntryDto) {}
