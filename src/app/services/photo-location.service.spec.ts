import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_FIX_MAX_AGE_MS, PhotoLocationService, isoWithOffset } from './photo-location.service';

type Success = (p: GeolocationPosition) => void;
type Failure = (e: GeolocationPositionError) => void;

describe('PhotoLocationService', () => {
  let success: Success | null;
  let failure: Failure | null;
  let watchPosition: ReturnType<typeof vi.fn>;
  let clearWatch: ReturnType<typeof vi.fn>;
  let original: Geolocation | undefined;

  beforeEach(() => {
    success = null;
    failure = null;
    watchPosition = vi.fn((ok: Success, err: Failure) => {
      success = ok;
      failure = err;
      return 7;
    });
    clearWatch = vi.fn();
    original = navigator.geolocation;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { watchPosition, clearWatch, getCurrentPosition: vi.fn() },
    });
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: original });
  });

  function fix(lat: number, lng: number, accuracy: number): GeolocationPosition {
    return { coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition;
  }

  function error(code: number): GeolocationPositionError {
    return { code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
  }

  it('desligada (nunca iniciada): não pede nada e o disparo não leva localização', () => {
    const service = TestBed.inject(PhotoLocationService);
    expect(service.snapshot()).toEqual({});
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('pede UMA vez por captura, não a cada foto', () => {
    const service = TestBed.inject(PhotoLocationService);
    service.start();
    service.start();
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('concedida: o disparo leva a leitura mais recente com a precisão', () => {
    const service = TestBed.inject(PhotoLocationService);
    service.start();
    success!(fix(-23.561414, -46.655881, 12));
    expect(service.state()).toBe('granted');
    expect(service.snapshot()).toEqual({
      locationStatus: 'GRANTED',
      latitude: -23.561414,
      longitude: -46.655881,
      accuracy: 12,
    });
  });

  it('negada: a foto segue com DENIED, sem coordenada, e não pergunta de novo', () => {
    const service = TestBed.inject(PhotoLocationService);
    service.start();
    failure!(error(1));
    expect(service.state()).toBe('denied');
    expect(service.snapshot()).toEqual({ locationStatus: 'DENIED' });
    expect(clearWatch).toHaveBeenCalledWith(7);
    service.start();
    expect(watchPosition).toHaveBeenCalledTimes(1);
  });

  it('sem leitura ainda: TIMEOUT; aparelho sem sinal: UNAVAILABLE', () => {
    const service = TestBed.inject(PhotoLocationService);
    service.start();
    expect(service.snapshot()).toEqual({ locationStatus: 'TIMEOUT' });
    failure!(error(2));
    expect(service.snapshot()).toEqual({ locationStatus: 'UNAVAILABLE' });
  });

  it('leitura velha não passa por posição da foto', () => {
    const service = TestBed.inject(PhotoLocationService);
    service.start();
    success!(fix(-23.5, -46.6, 5));
    expect(service.snapshot(Date.now() + PHOTO_FIX_MAX_AGE_MS + 1)).toEqual({
      locationStatus: 'TIMEOUT',
    });
  });

  it('stop esquece a leitura e para de acompanhar', () => {
    const service = TestBed.inject(PhotoLocationService);
    service.start();
    success!(fix(-23.5, -46.6, 5));
    service.stop();
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(service.snapshot()).toEqual({});
  });

  it('isoWithOffset carrega o fuso do aparelho', () => {
    const iso = isoWithOffset(new Date('2026-11-05T17:30:00Z'));
    expect(iso).toMatch(/^2026-11-0\dT\d{2}:30:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso).toISOString()).toBe('2026-11-05T17:30:00.000Z');
  });
});
