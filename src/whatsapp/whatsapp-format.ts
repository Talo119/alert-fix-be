const MIN_DIGITS = 8;
const MAX_DIGITS = 15; // máximo de E.164

/**
 * Normaliza un teléfono al formato que espera la Cloud API: E.164 sin '+'.
 *
 * - Quita espacios, guiones, puntos y paréntesis.
 * - `+` o `00` al inicio indican que ya trae código de país.
 * - Sin ellos, si no empieza por `defaultCountryCode` seguido de un número
 *   local completo (8+ dígitos), se le antepone `defaultCountryCode`.
 *
 * Devuelve `null` si el resultado no tiene entre 8 y 15 dígitos.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountryCode: string,
): string | null {
  if (!raw) return null;
  const compact = raw.trim().replace(/[\s\-.()]/g, '');

  let digits: string;
  if (compact.startsWith('+')) digits = compact.slice(1);
  else if (compact.startsWith('00')) digits = compact.slice(2);
  else if (
    compact.startsWith(defaultCountryCode) &&
    compact.length >= defaultCountryCode.length + MIN_DIGITS
  )
    digits = compact;
  else digits = defaultCountryCode + compact;

  if (!/^\d+$/.test(digits)) return null;
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;
  return digits;
}

/**
 * Los parámetros de plantilla no admiten saltos de línea, tabs ni más de 4
 * espacios seguidos: se colapsa todo espacio en blanco a uno solo.
 */
export function sanitizeParam(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
