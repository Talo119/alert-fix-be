#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1339c6841212c5d2d542c4b1be8d0dd2bcbfeb9088ed936cd662c2b1fce1e060/contract';
import startContract from '../../snapshots/1339c6841212c5d2d542c4b1be8d0dd2bcbfeb9088ed936cd662c2b1fce1e060/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5cbcc9dbb29b22701d3e9f4092c7be2f1d41f5bb4574b9fe989066db91801fd8/contract';
import endContract from '../../snapshots/5cbcc9dbb29b22701d3e9f4092c7be2f1d41f5bb4574b9fe989066db91801fd8/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Reminder',
        column: col('lastError', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'Reminder',
        column: col('sentAt', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
