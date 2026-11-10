import { describe, expect, it } from 'vitest';
import type { InspectionPhoto } from '../../types/inspection.types';
import {
  NO_PLACE,
  NO_PLACE_DENIED,
  NO_PLACE_DEVICE,
  NO_PLACE_GALLERY,
  formatStampTime,
  photoStamp,
} from './photo-stamp';

const BASE: InspectionPhoto = {
  id: 'p1',
  inspectionId: 'i1',
  angle: 'FRONT',
  mimeType: 'image/jpeg',
  sizeBytes: 10,
  signedUrl: 'https://x/y.jpg',
  createdDate: '2026-11-02T23:32:20',
};

const CAPTURED = '2026-11-02T23:32:12-03:00';
const RECEIVED = '2026-11-03T02:32:20Z'; // 23:32:20 em São Paulo

function photo(extra: Partial<InspectionPhoto>): InspectionPhoto {
  return { ...BASE, ...extra };
}

describe('photoStamp — hora e local de cada foto', () => {
  it('formata em dd/MM HH:mm:ss no fuso de São Paulo, qualquer que seja o aparelho', () => {
    expect(formatStampTime(RECEIVED)).toBe('02/11 23:32:20');
    expect(formatStampTime('lixo')).toBeNull();
    expect(formatStampTime(null)).toBeNull();
  });

  it('foto antiga (sem hora gravada) não tem linhas', () => {
    expect(photoStamp(photo({}), true)).toEqual({
      when: null,
      where: null,
      whereMissing: false,
      mapUrl: null,
    });
    expect(photoStamp(null, true).when).toBeNull();
  });

  it('câmera com endereço', () => {
    const s = photoStamp(
      photo({
        capturedAt: CAPTURED,
        receivedAt: RECEIVED,
        address: 'Av. Paulista, 1578 · Bela Vista, São Paulo/SP',
        captureSource: 'CAMERA',
        locationStatus: 'GRANTED',
      }),
      true,
    );
    expect(s.when).toBe('02/11 23:32:12');
    expect(s.where).toBe('Av. Paulista, 1578 · Bela Vista, São Paulo/SP');
    expect(s.whereMissing).toBe(false);
    expect(s.mapUrl).toBeNull();
  });

  it('precisão ruim marca aproximado', () => {
    const s = photoStamp(
      photo({ capturedAt: CAPTURED, receivedAt: RECEIVED, address: 'Rua X, 1', approximate: true }),
      true,
    );
    expect(s.where).toBe('Rua X, 1 (aproximado)');
  });

  it('sem endereço ainda: coordenada com link do mapa', () => {
    const s = photoStamp(
      photo({
        capturedAt: CAPTURED,
        receivedAt: RECEIVED,
        latitude: -23.5614,
        longitude: -46.6559,
        locationStatus: 'GRANTED',
      }),
      true,
    );
    expect(s.where).toBe('-23.5614, -46.6559');
    expect(s.mapUrl).toBe('https://www.google.com/maps/search/?api=1&query=-23.5614,-46.6559');
  });

  it('permissão negada e aparelho que não conseguiu têm rótulos diferentes', () => {
    const denied = photoStamp(
      photo({ capturedAt: CAPTURED, receivedAt: RECEIVED, locationStatus: 'DENIED' }),
      true,
    );
    expect(denied.where).toBe(NO_PLACE_DENIED);
    expect(denied.whereMissing).toBe(true);
    expect(denied.when).toBe('02/11 23:32:12');

    const timeout = photoStamp(
      photo({ capturedAt: CAPTURED, receivedAt: RECEIVED, locationStatus: 'TIMEOUT' }),
      true,
    );
    expect(timeout.where).toBe(NO_PLACE_DEVICE);
  });

  it('galeria: hora de envio rotulada e sem local', () => {
    const s = photoStamp(photo({ receivedAt: RECEIVED, captureSource: 'GALLERY' }), true);
    expect(s.when).toBe('Enviada da galeria · 02/11 23:32:20');
    expect(s.where).toBe(NO_PLACE_GALLERY);
    expect(s.whereMissing).toBe(true);
  });

  it('relógio do aparelho diferente: mostra as duas horas', () => {
    const s = photoStamp(
      photo({ capturedAt: '2026-11-02T18:32:12-03:00', receivedAt: RECEIVED, clockSkew: true }),
      true,
    );
    expect(s.when).toBe('02/11 18:32:12 · relógio do aparelho diferente; recebida 02/11 23:32:20');
  });

  it('sem hora do aparelho mas recebida: diz isso', () => {
    const s = photoStamp(photo({ receivedAt: RECEIVED }), true);
    expect(s.when).toBe('Recebida 02/11 23:32:20 · hora do aparelho não informada');
    expect(s.where).toBe(NO_PLACE);
  });

  it('localização desligada no servidor: só a hora', () => {
    const s = photoStamp(photo({ capturedAt: CAPTURED, receivedAt: RECEIVED }), false);
    expect(s.when).toBe('02/11 23:32:12');
    expect(s.where).toBeNull();
  });
});
