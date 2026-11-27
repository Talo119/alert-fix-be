import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateReminderDto } from './update-reminder.dto.js';

describe('UpdateReminderDto', () => {
  // Mismas opciones que src/main.ts.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: UpdateReminderDto });

  it.each([
    { remindAt: null },
    { message: null },
    { status: null },
    { type: null },
    { type: 'OTHER' },
    { status: 'SENT' },
    { lastError: 'x' },
  ])('rejects %j', async (body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    {},
    { orderId: null },
    { status: 'PENDING' },
    { type: 'CONFIRMATION' },
    { type: 'REMINDER' },
  ])('accepts %j', async (body) => {
    await expect(validate(body)).resolves.toEqual(body);
  });
});
