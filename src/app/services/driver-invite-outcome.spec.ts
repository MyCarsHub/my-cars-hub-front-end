import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import {
  DRIVER_REGISTRATION_INCOMPLETE_COPY,
  driverInviteOutcome,
  isDriverRegistrationIncomplete,
} from './driver-invite-outcome';

describe('driverInviteOutcome', () => {
  it('PENDING names the e-mail', () => {
    expect(driverInviteOutcome({ status: 'PENDING', inviteId: 'i' }, 'a@b.com')).toEqual({
      kind: 'sent',
      message: 'Motorista cadastrado. Convite enviado para a@b.com.',
    });
  });

  it('FAILED carries the reason and the invite id when there is one', () => {
    const outcome = driverInviteOutcome(
      { status: 'FAILED', code: 'INVITE_ALREADY_MEMBER', inviteId: 'i' },
      'a@b.com',
    );
    expect(outcome).toEqual({
      kind: 'refused',
      message:
        'Motorista cadastrado, mas o convite não foi enviado (esta pessoa já faz parte da empresa).',
      inviteId: 'i',
    });
  });

  it('NOT_SENT and a missing part are not warnings', () => {
    expect(driverInviteOutcome({ status: 'NOT_SENT' }, 'a@b.com').kind).toBe('not-sent');
    expect(driverInviteOutcome(undefined, 'a@b.com').kind).toBe('none');
  });
});

describe('DRIVER_REGISTRATION_INCOMPLETE', () => {
  it('is recognised by code, not by status or message', () => {
    const err = new HttpErrorResponse({
      status: 409,
      error: { code: 'driver_registration_incomplete', message: 'x' },
    });
    expect(isDriverRegistrationIncomplete(err)).toBe(true);
    expect(
      isDriverRegistrationIncomplete(new HttpErrorResponse({ status: 409, error: { message: 'x' } })),
    ).toBe(false);
    expect(DRIVER_REGISTRATION_INCOMPLETE_COPY).toContain('ainda não completou o cadastro');
  });
});
