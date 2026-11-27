#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0c737946c25310ea71659155bd9ca201f94a1b3a8576acec924621edc37ae0d1/contract';
import endContract from '../../snapshots/0c737946c25310ea71659155bd9ca201f94a1b3a8576acec924621edc37ae0d1/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/62cc4fdc86987ec538abdbeaa771c34938108408d9cadbf2a2de4770122d731f/contract';
import startContract from '../../snapshots/62cc4fdc86987ec538abdbeaa771c34938108408d9cadbf2a2de4770122d731f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'OrderHeader',
        column: col('nextServiceDate', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Reminder',
        column: col('type', 'text', {
          notNull: true,
          default: lit('REMINDER'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Service',
        column: col('frequencyUnit', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Service',
        column: col('frequencyValue', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
