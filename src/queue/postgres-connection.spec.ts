import { bullmqPostgresConnection } from './postgres-connection.js';

describe('bullmqPostgresConnection', () => {
  it('pasa la URL como connectionString con migrate: true', () => {
    const url = 'postgresql://us%40er:p%3Ass%2Fw@db.example.com:6543/app';

    expect(bullmqPostgresConnection(url)).toEqual({
      connectionString: url,
      migrate: true,
    });
  });

  it('no pasa la URL como cadena suelta (BullMQ ignoraría migrate)', () => {
    expect(typeof bullmqPostgresConnection('postgresql://h/db')).toBe('object');
  });

  it('falla si no hay URL', () => {
    expect(() => bullmqPostgresConnection('')).toThrow(/DATABASE_URL/);
  });
});
