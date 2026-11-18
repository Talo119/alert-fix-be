import { loadWhatsappConfig } from './whatsapp.config.js';

const env = {
  WHATSAPP_ACCESS_TOKEN: 'token',
  WHATSAPP_PHONE_NUMBER_ID: '123',
  WHATSAPP_API_VERSION: 'v23.0',
  WHATSAPP_TEMPLATE_NAME: 'recordatorio_mantenimiento',
  WHATSAPP_TEMPLATE_LANG: 'es',
  WHATSAPP_DEFAULT_COUNTRY_CODE: '504',
};

describe('loadWhatsappConfig', () => {
  it('lee todas las variables', () => {
    expect(loadWhatsappConfig(env)).toEqual({
      accessToken: 'token',
      phoneNumberId: '123',
      apiVersion: 'v23.0',
      templateName: 'recordatorio_mantenimiento',
      templateLang: 'es',
      defaultCountryCode: '504',
    });
  });

  it('falla nombrando las variables que faltan o están vacías', () => {
    expect(() =>
      loadWhatsappConfig({
        ...env,
        WHATSAPP_ACCESS_TOKEN: '',
        WHATSAPP_PHONE_NUMBER_ID: undefined,
      }),
    ).toThrow(/WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID/);
  });

  it('falla si el código de país no son dígitos', () => {
    expect(() =>
      loadWhatsappConfig({ ...env, WHATSAPP_DEFAULT_COUNTRY_CODE: '+504' }),
    ).toThrow(/WHATSAPP_DEFAULT_COUNTRY_CODE/);
  });
});
