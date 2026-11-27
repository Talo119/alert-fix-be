import { confirmPayload, parseConfirmPayload } from './confirm-payload.js';

const uuid = '6f1c2b1e-4c8a-4f5e-9a51-3b0b9d5f2a10';

describe('confirm payload', () => {
  it('CONFIRM:<uuid> → uuid', () => {
    expect(parseConfirmPayload(`CONFIRM:${uuid}`)).toBe(uuid);
  });

  it.each([
    [`CANCEL:${uuid}`],
    [`confirm:${uuid}`],
    ['CONFIRM:not-a-uuid'],
    [`CONFIRM:${uuid}x`],
    ['CONFIRM:'],
    [''],
    [undefined],
  ])('%s → null', (payload) => {
    expect(parseConfirmPayload(payload)).toBeNull();
  });

  it('confirmPayload y parseConfirmPayload son inversas', () => {
    expect(confirmPayload(uuid)).toBe(`CONFIRM:${uuid}`);
    expect(parseConfirmPayload(confirmPayload(uuid))).toBe(uuid);
  });
});
