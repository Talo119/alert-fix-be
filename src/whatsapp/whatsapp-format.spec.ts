import { normalizePhone, sanitizeParam } from './whatsapp-format.js';

describe('normalizePhone', () => {
  it.each([
    ['+504 9999-8888', '50499998888'],
    ['99998888', '50499998888'],
    ['9999 8888', '50499998888'],
    ['(504) 9999.8888', '50499998888'],
    ['50499998888', '50499998888'],
    ['0050499998888', '50499998888'],
    ['+1 (415) 555-0100', '14155550100'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhone(raw, '504')).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['+12345'], // muy corto
    ['+1234567890123456'], // más de 15 dígitos
    ['9999-ABCD'],
  ])('%s → null', (raw) => {
    expect(normalizePhone(raw, '504')).toBeNull();
  });
});

describe('sanitizeParam', () => {
  it('quita saltos de línea, tabs y espacios repetidos', () => {
    expect(sanitizeParam('  Hola\n\nmundo\t  con     espacios \r\n')).toBe(
      'Hola mundo con espacios',
    );
  });

  it('deja intacto un texto ya limpio', () => {
    expect(sanitizeParam('Cambio de filtro')).toBe('Cambio de filtro');
  });
});
