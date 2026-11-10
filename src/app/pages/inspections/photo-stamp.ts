import type { InspectionPhoto } from '../../types/inspection.types';

/**
 * As duas linhas sob cada foto da vistoria: HORA e LOCAL, com rótulo honesto para cada caso.
 *
 * É a mesma regra do laudo em PDF (`PhotoStampText` no backend). Os textos precisam bater:
 * o dono confere a página contra o laudo.
 *
 * - Foto antiga (sem nenhuma hora gravada): sem linhas.
 * - Galeria: a hora de RECEBIMENTO, rotulada "enviada da galeria", e sem local.
 * - Relógio do aparelho diferente do servidor: as duas horas, nunca só a do aparelho.
 * - Sem endereço ainda: a coordenada arredondada, com link para o mapa.
 * - Permissão negada × aparelho que não conseguiu: rótulos diferentes.
 * - Localização desligada no servidor: só a hora.
 */
export interface PhotoStamp {
  /** Linha da hora; `null` = foto antiga, sem linha. */
  readonly when: string | null;
  /** Linha do local; `null` = não mostrar a linha. */
  readonly where: string | null;
  /** O local falta (pintado em âmbar, como no desenho). */
  readonly whereMissing: boolean;
  /** Link do mapa quando só há a coordenada. */
  readonly mapUrl: string | null;
}

export const NO_PLACE_DENIED = 'Sem local (não autorizado)';
export const NO_PLACE_DEVICE = 'Sem local (o aparelho não informou)';
export const NO_PLACE_GALLERY = 'Sem local (foto da galeria)';
export const NO_PLACE = 'Local não informado';

const EMPTY: PhotoStamp = { when: null, where: null, whereMissing: false, mapUrl: null };

/** `dd/MM HH:mm:ss` no fuso de São Paulo — o mesmo do laudo, qualquer que seja o aparelho. */
const SHORT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatStampTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(SHORT.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts['day']}/${parts['month']} ${parts['hour']}:${parts['minute']}:${parts['second']}`;
}

function coordinate(value: number): string {
  return value.toFixed(4);
}

export function photoStamp(photo: InspectionPhoto | null, locationEnabled: boolean): PhotoStamp {
  if (!photo) return EMPTY;
  const captured = formatStampTime(photo.capturedAt);
  const received = formatStampTime(photo.receivedAt);
  if (!captured && !received) return EMPTY;

  if (photo.captureSource === 'GALLERY') {
    return {
      when: received ? `Enviada da galeria · ${received}` : 'Enviada da galeria',
      where: NO_PLACE_GALLERY,
      whereMissing: true,
      mapUrl: null,
    };
  }

  let when: string;
  if (!captured) {
    when = `Recebida ${received} · hora do aparelho não informada`;
  } else if (photo.clockSkew && received) {
    when = `${captured} · relógio do aparelho diferente; recebida ${received}`;
  } else {
    when = captured;
  }

  const suffix = photo.approximate ? ' (aproximado)' : '';
  const address = photo.address?.trim();
  if (address) {
    return { when, where: address + suffix, whereMissing: false, mapUrl: null };
  }
  if (typeof photo.latitude === 'number' && typeof photo.longitude === 'number') {
    const lat = coordinate(photo.latitude);
    const lng = coordinate(photo.longitude);
    return {
      when,
      where: `${lat}, ${lng}${suffix}`,
      whereMissing: false,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    };
  }
  if (photo.locationStatus) {
    const where = photo.locationStatus === 'DENIED' ? NO_PLACE_DENIED : NO_PLACE_DEVICE;
    return { when, where, whereMissing: true, mapUrl: null };
  }
  if (!locationEnabled) return { when, where: null, whereMissing: false, mapUrl: null };
  return { when, where: NO_PLACE, whereMissing: true, mapUrl: null };
}
