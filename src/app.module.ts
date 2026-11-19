import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ScheduleModule } from '@nestjs/schedule';
import { ReminderModule } from './reminder/reminder.module.js';
import { BullModule } from '@nestjs/bullmq';
import { createPostgresBackend } from 'bullmq';
import { bullmqPostgresConnection } from './queue/postgres-connection.js';
import { UserModule } from './user/user.module.js';
import { CompanyModule } from './company/company.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com,
    // then run `npx @nestjs/observe link` to write your key pair into .env.
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'alter-fix-be',
    }),
    ScheduleModule.forRoot(),
    // BullMQ sobre PostgreSQL (sin Redis). Factory para leer DATABASE_URL al
    // inicializar el módulo, no al importar este archivo.
    BullModule.forRootAsync({
      useFactory: () => ({
        backendFactory: createPostgresBackend,
        connection: bullmqPostgresConnection(),
      }),
    }),
    ReminderModule,
    UserModule,
    CompanyModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
