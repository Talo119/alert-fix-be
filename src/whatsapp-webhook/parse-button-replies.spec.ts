import { parseButtonReplies } from './parse-button-replies.js';

const buttonMessage = (from: string, payload: string, id = 'wamid.REPLY') => ({
  from,
  id,
  timestamp: '1764280000',
  type: 'button',
  context: { from: '15550001111', id: 'wamid.ORIGINAL' },
  button: { payload, text: 'Confirmar' },
});

const textMessage = {
  from: '50499998888',
  id: 'wamid.TEXT',
  timestamp: '1764280000',
  type: 'text',
  text: { body: 'Sí' },
};

/** Evento con la forma real de Meta. */
const event = (...changes: object[]) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA_ID', changes }],
});

const messagesChange = (...messages: object[]) => ({
  field: 'messages',
  value: {
    messaging_product: 'whatsapp',
    metadata: {
      display_phone_number: '15550001111',
      phone_number_id: 'PHONE_NUMBER_ID',
    },
    contacts: [{ profile: { name: 'Ana' }, wa_id: '50499998888' }],
    messages,
  },
});

describe('parseButtonReplies', () => {
  it('un button → from, payload y messageId', () => {
    expect(
      parseButtonReplies(
        event(messagesChange(buttonMessage('50499998888', 'CONFIRM:x'))),
      ),
    ).toEqual([
      { from: '50499998888', payload: 'CONFIRM:x', messageId: 'wamid.REPLY' },
    ]);
  });

  it('un mensaje de texto → nada', () => {
    expect(parseButtonReplies(event(messagesChange(textMessage)))).toEqual([]);
  });

  it('solo statuses → nada', () => {
    expect(
      parseButtonReplies(
        event({
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            statuses: [{ id: 'wamid.X', status: 'delivered' }],
          },
        }),
      ),
    ).toEqual([]);
  });

  it('ignora changes con otro field', () => {
    expect(
      parseButtonReplies(
        event({
          field: 'message_template_status_update',
          value: { messages: [buttonMessage('1', 'CONFIRM:x')] },
        }),
      ),
    ).toEqual([]);
  });

  it('recorre varias entry, changes y messages', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'A',
          changes: [
            messagesChange(
              buttonMessage('111111111', 'P1', 'w1'),
              textMessage,
              buttonMessage('222222222', 'P2', 'w2'),
            ),
            messagesChange(buttonMessage('333333333', 'P3', 'w3')),
          ],
        },
        {
          id: 'B',
          changes: [messagesChange(buttonMessage('444', 'P4', 'w4'))],
        },
      ],
    };
    expect(parseButtonReplies(body).map((r) => r.payload)).toEqual([
      'P1',
      'P2',
      'P3',
      'P4',
    ]);
  });

  it.each([
    ['vacío', {}],
    ['null', null],
    ['undefined', undefined],
    ['string', 'hola'],
    ['entry no es array', { entry: 'x' }],
    ['entry con null', { entry: [null] }],
    ['changes no es array', { entry: [{ changes: {} }] }],
    [
      'messages no es array',
      event({ field: 'messages', value: { messages: 1 } }),
    ],
    ['value null', event({ field: 'messages', value: null })],
    [
      'button sin payload',
      event(messagesChange({ from: '1', type: 'button', button: {} })),
    ],
    [
      'button sin from',
      event(messagesChange({ type: 'button', button: { payload: 'P' } })),
    ],
  ])('mal formado (%s) → nada, sin lanzar', (_, body) => {
    expect(parseButtonReplies(body)).toEqual([]);
  });
});
