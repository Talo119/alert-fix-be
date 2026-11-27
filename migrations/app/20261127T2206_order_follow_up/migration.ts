#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0c737946c25310ea71659155bd9ca201f94a1b3a8576acec924621edc37ae0d1/contract';
import startContract from '../../snapshots/0c737946c25310ea71659155bd9ca201f94a1b3a8576acec924621edc37ae0d1/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/422e3867ed96e9d23d5b075667a4065995af58de19a94ba7f3ca651f3e2b26b2/contract';
import endContract from '../../snapshots/422e3867ed96e9d23d5b075667a4065995af58de19a94ba7f3ca651f3e2b26b2/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'OrderHeader',
        column: col('previousOrderId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'OrderHeader',
        constraint: 'OrderHeader_previousOrderId_key',
        columns: ['previousOrderId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
