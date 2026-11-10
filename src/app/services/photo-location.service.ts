import { Injectable, signal } from '@angular/core';
import type { PhotoCaptureMeta } from '../types/inspection.types';

/** Uma leitura do aparelho com mais idade que isto não descreve onde a foto foi tirada. */
export const PHOTO_FIX_MAX_AGE_MS = 2 * 60 * 1000;

/** Opções do `watchPosition`: GPS de alta precisão, leitura recente, sem esperar para sempre. */
const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 10_000,
  timeout: 20_000,
};

/** Em que pé está o pedido de localização desta captura. */
export type PhotoLocationState = 'off' | 'asking' | 'granted' | 'denied' | 'unavailable';

type LocationPart = Pick<PhotoCaptureMeta, 'latitude' | 'longitude' | 'accuracy' | 'locationStatus'>;

/**
 * A localização do aparelho durante a captura da vistoria.
 *
 * ## Uma permissão por captura, não por foto
 *
 * `start()` é chamado UMA vez, quando a captura abre (e só com a localização ligada no
 * servidor): o navegador pergunta uma vez e passa a entregar leituras por `watchPosition`. No
 * disparo, `snapshot()` devolve a leitura mais recente NA HORA — a foto nunca espera o GPS e
 * nunca falha por causa dele.
 *
 * ## Negar não bloqueia
 *
 * Negado, a foto segue com a hora e `locationStatus = DENIED`, e a tela/laudo dizem
 * "sem local (não autorizado)". Não se pergunta de novo na mesma captura.
 */
@Injectable({ providedIn: 'root' })
export class PhotoLocationService {
  private watchId: number | null = null;
  private last: { latitude: number; longitude: number; accuracy: number; at: number } | null =
    null;

  private readonly _state = signal<PhotoLocationState>('off');
  readonly state = this._state.asReadonly();

  private geolocation(): Geolocation | null {
    return typeof navigator !== 'undefined' && navigator.geolocation
      ? navigator.geolocation
      : null;
  }

  /** Pede a permissão e começa a acompanhar a posição. Idempotente. */
  start(): void {
    if (this.watchId !== null || this._state() === 'denied') return;
    const geo = this.geolocation();
    if (!geo) {
      this._state.set('unavailable');
      return;
    }
    this._state.set('asking');
    this.watchId = geo.watchPosition(
      (position) => {
        this.last = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          at: Date.now(),
        };
        this._state.set('granted');
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          // Negado: para de pedir. Esta captura segue sem local.
          this._state.set('denied');
          this.clearWatch();
          return;
        }
        // Sem sinal ou demora: continua tentando; a foto vai sem local enquanto isso.
        if (this._state() !== 'granted') this._state.set('unavailable');
      },
      WATCH_OPTIONS,
    );
  }

  /** Para de acompanhar e esquece a última leitura (saída da captura). */
  stop(): void {
    this.clearWatch();
    this.last = null;
    this._state.set('off');
  }

  /**
   * O que vai junto da foto, no instante do disparo. `{}` com a localização desligada: nada
   * de status, nada de coordenada.
   */
  snapshot(now: number = Date.now()): LocationPart {
    const state = this._state();
    if (state === 'off') return {};
    if (state === 'denied') return { locationStatus: 'DENIED' };
    const fix = this.last;
    if (fix && now - fix.at <= PHOTO_FIX_MAX_AGE_MS) {
      return {
        locationStatus: 'GRANTED',
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
      };
    }
    return { locationStatus: state === 'unavailable' ? 'UNAVAILABLE' : 'TIMEOUT' };
  }

  private clearWatch(): void {
    if (this.watchId !== null) {
      this.geolocation()?.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

/** ISO-8601 com o fuso do aparelho (`2026-11-05T14:30:00-03:00`), o que o servidor aceita. */
export function isoWithOffset(date: Date): string {
  const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}
