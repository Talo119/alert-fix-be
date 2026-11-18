import type { PostgresPoolConfig } from 'bullmq';

/**
 * Opciones de `connection` para el backend PostgreSQL de BullMQ.
 *
 * BullMQ acepta `connectionString` dentro del objeto de configuración del pool
 * (lo decodifica `pg`), así que no hace falta parsear la URL a mano. Tiene que
 * ser la forma de objeto: con una cadena suelta BullMQ ignora `migrate`.
 *
 * `migrate: true` crea/actualiza las tablas de BullMQ al arrancar, en el schema
 * `bullmq` (el valor por defecto), separado del schema `public` de Prisma.
 */
export function bullmqPostgresConnection(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): PostgresPoolConfig {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL no está definida: BullMQ no puede conectarse',
    );
  }
  return { connectionString: databaseUrl, migrate: true };
}
