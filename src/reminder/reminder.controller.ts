import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReminderService } from './reminder.service.js';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { UpdateReminderDto } from './dto/update-reminder.dto.js';

@ApiTags('reminder')
@Controller('reminder')
export class ReminderController {
  constructor(private readonly reminderService: ReminderService) {}

  /** Programa un recordatorio (queda en `PENDING`). */
  @Post()
  create(@Body() createReminderDto: CreateReminderDto) {
    return this.reminderService.create(createReminderDto);
  }

  /** Lista los recordatorios. */
  @Get()
  findAll() {
    return this.reminderService.findAll();
  }

  /** Obtiene un recordatorio por id. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.reminderService.findOne(id);
  }

  /** Actualiza o reintenta un recordatorio; 409 si está `QUEUED` o `SENT`. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateReminderDto: UpdateReminderDto,
  ) {
    return this.reminderService.update(id, updateReminderDto);
  }

  /** Elimina un recordatorio. */
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.reminderService.remove(id);
  }
}
