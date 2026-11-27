import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateOrderHeaderDto } from './create-order-header.dto.js';
import { UpdateOrderHeaderDto } from './update-order-header.dto.js';

describe('OrderHeader DTOs', () => {
  // Mismas opciones que src/main.ts.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (metatype: unknown, body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: metatype as never });
  const nextServiceDate = '2027-01-01T00:00:00.000Z';

  // `nextServiceDate` lo calcula el service al completar (spec 12).
  it('rejects nextServiceDate on create', async () => {
    await expect(
      validate(CreateOrderHeaderDto, {
        serviceDate: '2026-12-01T14:00:00.000Z',
        status: 'OPEN',
        entries: [{ quantity: 1 }],
        nextServiceDate,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([{ nextServiceDate }, { nextServiceDate: null }])(
    'rejects %j on update',
    async (body) => {
      await expect(validate(UpdateOrderHeaderDto, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('accepts a status change on update', async () => {
    await expect(
      validate(UpdateOrderHeaderDto, { status: 'COMPLETED' }),
    ).resolves.toEqual({ status: 'COMPLETED' });
  });
});
