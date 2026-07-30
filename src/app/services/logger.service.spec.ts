import { TestBed } from '@angular/core/testing';
import * as Sentry from '@sentry/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggerService } from './logger.service';

// The Sentry namespace is an ESM binding and cannot be `vi.spyOn`'d, so the
// module itself is mocked. Only the two capture functions the logger uses are
// stubbed.
vi.mock('@sentry/angular', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const captureMessage = vi.mocked(Sentry.captureMessage);
const captureException = vi.mocked(Sentry.captureException);

describe('LoggerService', () => {
  let service: LoggerService;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureMessage.mockReset();
    captureException.mockReset();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [LoggerService] });
    service = TestBed.inject(LoggerService);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  describe('warn', () => {
    it('captures the message in Sentry at warning level with the context as extra', () => {
      service.warn('foto omitida do PDF', { photoId: 'p1', angle: 'FRONT' });

      expect(captureMessage).toHaveBeenCalledTimes(1);
      expect(captureMessage).toHaveBeenCalledWith('foto omitida do PDF', {
        level: 'warning',
        extra: { photoId: 'p1', angle: 'FRONT' },
      });
    });

    it('never routes a warning through captureException', () => {
      service.warn('degradação parcial');

      expect(captureException).not.toHaveBeenCalled();
    });

    it('marks the console line as a warning so it is distinguishable from a real error', () => {
      service.warn('degradação parcial', { a: 1 });

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(String(consoleError.mock.calls[0][0])).toBe('[warn] degradação parcial');
      expect(consoleError.mock.calls[0][1]).toEqual({ a: 1 });
    });

    it('works without a context argument', () => {
      expect(() => service.warn('sem contexto')).not.toThrow();

      expect(captureMessage).toHaveBeenCalledWith('sem contexto', {
        level: 'warning',
        extra: undefined,
      });
    });
  });

  describe('error', () => {
    it('captures the thrown Error in Sentry with the message and context as extra', () => {
      const boom = new Error('boom');

      service.error('upload falhou', boom, { rentalId: 'r-1' });

      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException).toHaveBeenCalledWith(boom, {
        extra: { message: 'upload falhou', rentalId: 'r-1' },
      });
    });

    it('normalizes a non-Error throwable so Sentry always receives an Error', () => {
      service.error('falhou', 'string solta');

      const captured = captureException.mock.calls[0][0];
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).message).toBe('string solta');
    });

    it('logs message, error and context to the console', () => {
      const boom = new Error('boom');

      service.error('upload falhou', boom, { rentalId: 'r-1' });

      expect(consoleError).toHaveBeenCalledWith('[error] upload falhou', boom, {
        rentalId: 'r-1',
      });
    });
  });

  // Today `environment.sentryDsn` is empty, so `Sentry.init()` never runs and
  // no client is bound. Logging must stay a safe operation in that state — and
  // must not become a new failure source if the SDK ever throws.
  describe('when Sentry is not initialized', () => {
    it('does not throw from warn', () => {
      captureMessage.mockImplementation(() => {
        throw new Error('Sentry not initialized');
      });

      expect(() => service.warn('aviso', { a: 1 })).not.toThrow();
      expect(consoleError).toHaveBeenCalledTimes(1);
    });

    it('does not throw from error', () => {
      captureException.mockImplementation(() => {
        throw new Error('Sentry not initialized');
      });

      expect(() => service.error('falha', new Error('boom'))).not.toThrow();
      expect(consoleError).toHaveBeenCalledTimes(1);
    });
  });
});
