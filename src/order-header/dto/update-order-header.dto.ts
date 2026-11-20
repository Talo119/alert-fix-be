import { PartialType } from '@nestjs/swagger';
import { CreateOrderHeaderDto } from './create-order-header.dto.js';

export class UpdateOrderHeaderDto extends PartialType(CreateOrderHeaderDto) {}
