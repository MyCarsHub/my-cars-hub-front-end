import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import {
  attemptsLeftCopy,
  inviteAcceptProblemCopy,
  inviteAttemptsLeft,
  inviteFlowErrorCode,
  onboardingFailure,
} from './invite-flow-errors';

const err = (status: number, body: unknown) => new HttpErrorResponse({ status, error: body });

describe('invite-flow-errors', () => {
  it('reads the code case-insensitively and ignores anything that is not an HttpErrorResponse', () => {
    expect(inviteFlowErrorCode(err(409, { code: ' invite_locked ' }))).toBe('INVITE_LOCKED');
    expect(inviteFlowErrorCode(err(500, null))).toBeNull();
    expect(inviteFlowErrorCode(new Error('x'))).toBeNull();
  });

  it('reads attemptsLeft only when it is a non-negative number', () => {
    expect(inviteAttemptsLeft(err(400, { attemptsLeft: 2 }))).toBe(2);
    expect(inviteAttemptsLeft(err(400, { attemptsLeft: 0 }))).toBe(0);
    expect(inviteAttemptsLeft(err(400, { attemptsLeft: -1 }))).toBeNull();
    expect(inviteAttemptsLeft(err(400, { attemptsLeft: '3' }))).toBeNull();
    expect(inviteAttemptsLeft(err(400, {}))).toBeNull();
  });

  it('pluralises the attempts copy', () => {
    expect(attemptsLeftCopy(3)).toBe('Restam 3 tentativas.');
    expect(attemptsLeftCopy(1)).toBe('Resta 1 tentativa.');
  });

  it.each([
    ['INVITE_ACCOUNT_DISABLED', 'desativada'],
    ['INVITE_CPF_NOT_ON_FILE', 'Locadora Alfa'],
    ['INVITE_IDENTITY_CONFLICT', 'conflito'],
    ['INVITE_ALREADY_MEMBER', 'já faz parte de Locadora Alfa'],
    ['INVITE_DRIVER_NOT_REGISTERED', 'cadastro de motorista'],
    ['INVITE_EMAIL_MISMATCH', 'outro e-mail'],
    ['INVITE_GOOGLE_ACCOUNT_REQUIRED', 'conta Google'],
  ])('maps %s to its own copy', (code, fragment) => {
    expect(inviteAcceptProblemCopy(err(409, { code, message: 'raw' }), 'Locadora Alfa')).toContain(fragment);
  });

  it('falls back to a generic, rate-limit or offline copy for unknown causes', () => {
    expect(inviteAcceptProblemCopy(err(500, { code: 'X' }), 'A')).toContain('Tente novamente');
    expect(inviteAcceptProblemCopy(err(429, null), 'A')).toContain('Muitas tentativas');
    expect(inviteAcceptProblemCopy(err(0, null), 'A')).toContain('conexão');
  });

  it.each([
    ['ONBOARDING_NAME_INVALID', 'field'],
    ['ONBOARDING_PHONE_INVALID', 'field'],
    ['TERMS_VERSION_MISMATCH', 'terms'],
    ['ONBOARDING_TOKEN_REVOKED', 'revoked'],
    ['ONBOARDING_ROLE_MISMATCH', 'wrong-role'],
    ['ONBOARDING_ALREADY_DONE', 'done'],
    ['WHATEVER', 'generic'],
  ])('classifies onboarding %s as %s', (code, kind) => {
    expect(onboardingFailure(err(400, { code, message: 'raw' })).kind).toBe(kind);
  });
});
