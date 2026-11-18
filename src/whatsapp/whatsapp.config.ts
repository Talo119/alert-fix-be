export const WHATSAPP_CONFIG = Symbol('WHATSAPP_CONFIG');

export interface WhatsappConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  templateName: string;
  templateLang: string;
  /** Código de país (solo dígitos) que se antepone a números locales. */
  defaultCountryCode: string;
}

const REQUIRED = {
  accessToken: 'WHATSAPP_ACCESS_TOKEN',
  phoneNumberId: 'WHATSAPP_PHONE_NUMBER_ID',
  apiVersion: 'WHATSAPP_API_VERSION',
  templateName: 'WHATSAPP_TEMPLATE_NAME',
  templateLang: 'WHATSAPP_TEMPLATE_LANG',
  defaultCountryCode: 'WHATSAPP_DEFAULT_COUNTRY_CODE',
} as const satisfies Record<keyof WhatsappConfig, string>;

/**
 * Lee y valida la configuración de WhatsApp. Lanza si falta alguna variable,
 * así que un `.env` incompleto hace fallar el arranque de la app.
 */
export function loadWhatsappConfig(
  env: NodeJS.ProcessEnv = process.env,
): WhatsappConfig {
  const missing: string[] = [];
  const cfg = {} as WhatsappConfig;
  for (const [key, name] of Object.entries(REQUIRED) as [
    keyof WhatsappConfig,
    string,
  ][]) {
    const value = env[name]?.trim();
    if (value) cfg[key] = value;
    else missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `Configuración de WhatsApp incompleta, faltan: ${missing.join(', ')}`,
    );
  }
  if (!/^\d{1,3}$/.test(cfg.defaultCountryCode)) {
    throw new Error(
      'WHATSAPP_DEFAULT_COUNTRY_CODE debe ser de 1 a 3 dígitos, sin "+"',
    );
  }
  return cfg;
}
