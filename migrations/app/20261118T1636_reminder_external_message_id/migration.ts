#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5cbcc9dbb29b22701d3e9f4092c7be2f1d41f5bb4574b9fe989066db91801fd8/contract';
import startContract from '../../snapshots/5cbcc9dbb29b22701d3e9f4092c7be2f1d41f5bb4574b9fe989066db91801fd8/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/62cc4fdc86987ec538abdbeaa771c34938108408d9cadbf2a2de4770122d731f/contract';
import endContract from '../../snapshots/62cc4fdc86987ec538abdbeaa771c34938108408d9cadbf2a2de4770122d731f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'Reminder',
        column: col('externalMessageId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
