import type { Scalars } from '@prisma/orm-postgres/family-contract/types';
import type { Models } from '../prisma/contract.d';

/** Fila de `Reminder` tal como la devuelve una consulta por defecto (sin relaciones). */
export type Reminder = Scalars<Models.public_Reminder>;

export type OrderHeader = Scalars<Models.public_OrderHeader>;
export type Client = Scalars<Models.public_Client>;

/** Reminder con su orden y el cliente de la orden (lo que necesita el envío). */
export type ReminderWithClient = Reminder & {
  order: (OrderHeader & { client: Client | null }) | null;
};
