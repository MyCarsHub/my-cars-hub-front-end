import { INSPECTION_KIND_LABELS } from '../../utils/status-maps';
import { formatPtBrNumber } from '../../utils/ptbr-number';
import { maskPhone } from '../../utils/phone-mask';
import { RENTAL_PHOTO_ANGLES } from '../../types/rental.types';
import type {
  Inspection,
  InspectionKind,
  InspectionListItem,
  InspectionPhoto,
} from '../../types/inspection.types';
import { angleLabel } from './angle-label';

/**
 * A UNICA porta entre o que o servidor manda e o que as telas de vistoria desenham.
 *
 * Existe porque o backend das vistorias v2 foi construido EM PARALELO a esta tela: os
 * campos novos (hodometro, telefone, cor, ano, foto da frente) chegam opcionais, e quem os
 * le diretamente espalha `?? '—'` por cinco templates. Aqui a ausencia vira texto UMA vez.
 * Se o servidor renomear um campo, este e o unico arquivo a mudar.
 *
 * Nada aqui inventa dado: campo ausente vira `null` (e o template decide mostrar "—"), nunca
 * zero. Zero km e zero fotos sao afirmacoes.
 */

/**
 * O produto exige EXATAMENTE 14 fotos, uma por angulo. A lista nao recebe o roteiro da
 * vistoria (so o detalhe o retrata), entao o denominador do "N/14" e a lista canonica.
 */
export const INSPECTION_ANGLE_TOTAL = RENTAL_PHOTO_ANGLES.length;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  // `yyyy-MM-dd` puro e lido como dia LOCAL: `new Date('2026-10-25')` e meia-noite UTC e
  // mostraria o dia anterior em qualquer fuso a oeste de Greenwich.
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `dd/MM/yyyy`, ou `null` quando nao ha data legivel. Montado a mao: independe de locale. */
export function formatDate(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (!date) return null;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** `dd/MM/yyyy HH:mm`, ou `null`. */
export function formatDateTime(iso: string | null | undefined): string | null {
  const date = parse(iso);
  if (!date) return null;
  return `${formatDate(iso)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `82.109 km`, ou `null` quando o valor nao e um numero. Mesma gramatica dos campos de km. */
export function formatKm(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `${formatPtBrNumber(Math.round(value), 0)} km`;
}

/**
 * Telefone como o produto o escreve: `(11) 98123-4567`. O servidor manda o que o cadastro
 * tem (so digitos, ou texto livre): o que nao tem 10 ou 11 digitos passa como veio, em vez
 * de ser cortado pela mascara.
 */
export function formatPhone(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? maskPhone(digits) : raw;
}

/** "1 vistoria" / "3 vistorias" — o plural sempre resolvido, nunca "vistoria(s)". */
export function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Primeiro nome, para frases como "Carlos sera avisado". */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

/** "Retirada" / "Devolução" / "Frota". */
export function kindLabel(kind: InspectionKind): string {
  return INSPECTION_KIND_LABELS[kind] ?? kind;
}

/** A palavra em minuscula, para "Vistoria de retirada" e o nome do PDF. */
export function kindWord(kind: InspectionKind): string {
  return kindLabel(kind).toLowerCase();
}

/** Marca + modelo ("Fiat Mobi Like 1.0"), ou `null` quando o servidor nao mandou nenhum. */
export function carName(item: {
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
}): string | null {
  const name = [item.vehicleBrand, item.vehicleModel].filter(Boolean).join(' ').trim();
  return name || null;
}

/** "2023 · Branco" — cada metade e opcional; `null` quando nao ha nenhuma. */
export function colorAndYear(item: {
  vehicleColor?: string | null;
  vehicleYear?: number | null;
}): string | null {
  const parts = [item.vehicleYear ? String(item.vehicleYear) : null, item.vehicleColor?.trim() || null]
    .filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Uma linha da lista, pronta para desenhar. */
export interface InspectionCardView {
  readonly id: string;
  readonly plate: string;
  readonly model: string | null;
  readonly driver: string | null;
  readonly kind: string;
  readonly date: string | null;
  /** `null` quando o servidor nao mandou a contagem — a linha omite, nao escreve zero. */
  readonly photos: { readonly got: number; readonly total: number; readonly incomplete: boolean } | null;
  readonly frontPhotoUrl: string | null;
  readonly status: InspectionListItem['status'];
  readonly rentalId: string | null;
}

export function toCardView(item: InspectionListItem): InspectionCardView {
  const photos =
    typeof item.photoCount === 'number'
      ? {
          got: item.photoCount,
          total: INSPECTION_ANGLE_TOTAL,
          incomplete: item.photoCount < INSPECTION_ANGLE_TOTAL,
        }
      : null;
  return {
    id: item.id,
    plate: item.vehiclePlate?.trim() || 'Veículo não identificado',
    model: carName(item),
    driver: item.driverName?.trim() || null,
    kind: kindLabel(item.kind),
    date: formatDate(item.performedAt),
    photos,
    frontPhotoUrl: item.frontPhotoUrl || null,
    status: item.status,
    rentalId: item.rentalId,
  };
}

/** Um quadro da grade de 14: um angulo, com ou sem foto. */
export interface AngleFrame {
  readonly angle: string;
  readonly label: string;
  /** `true` quando o servidor tem uma foto deste angulo — com ou sem URL assinada. */
  readonly hasPhoto: boolean;
  /** `null` com `hasPhoto` = a foto existe e a assinatura dela falhou. */
  readonly signedUrl: string | null;
  /** Chave estavel da foto (nunca a URL). `null` sem foto. */
  readonly photoId: string | null;
  /** Quando a foto foi tirada, legivel (`dd/MM/yyyy HH:mm`). `null` sem foto ou sem data. */
  readonly takenAt: string | null;
}

/*
 * Apelidos legados: linhas gravadas antes das migracoes V62/V63 trazem `*_PANEL` onde hoje
 * se grava `*_TIRE`. Sem este mapa, uma vistoria antiga mostraria um quadro vazio de
 * "Pneu dianteiro esquerdo" e um quadro extra com o nome cru.
 */
const LEGACY: Readonly<Record<string, string>> = {
  FRONT_LEFT_PANEL: 'FRONT_LEFT_TIRE',
  FRONT_RIGHT_PANEL: 'FRONT_RIGHT_TIRE',
  REAR_LEFT_PANEL: 'REAR_LEFT_TIRE',
  REAR_RIGHT_PANEL: 'REAR_RIGHT_TIRE',
};

/**
 * Os quadros da vistoria: os 14 angulos canonicos, na ordem do roteiro, mais qualquer angulo
 * FORA da lista que tenha foto (o roteiro e configuravel por empresa) no fim.
 *
 * O roteiro que a vistoria retratou (`requiredAngles`) manda quando existe: uma empresa com
 * 12 angulos nao ve dois quadros vazios que ninguem pediu.
 */
export function buildFrames(
  photos: readonly InspectionPhoto[],
  requiredAngles: readonly string[] | null | undefined,
): AngleFrame[] {
  const byAngle = new Map<string, InspectionPhoto>();
  for (const photo of photos) {
    byAngle.set(LEGACY[photo.angle] ?? photo.angle, photo);
  }

  const canonical = RENTAL_PHOTO_ANGLES.map((a) => a.value as string);
  const required =
    requiredAngles && requiredAngles.length > 0
      ? requiredAngles.map((a) => LEGACY[a] ?? a)
      : canonical;
  const ordered = [...required].sort((a, b) => order(a, canonical) - order(b, canonical));
  const extras = [...byAngle.keys()].filter((a) => !ordered.includes(a));

  return [...ordered, ...extras].map((angle) => {
    const photo = byAngle.get(angle) ?? null;
    return {
      angle,
      label: angleLabel(angle),
      hasPhoto: photo !== null,
      signedUrl: photo?.signedUrl ?? null,
      photoId: photo?.id ?? null,
      takenAt: photo ? formatDateTime(photo.createdDate) : null,
    };
  });
}

function order(angle: string, canonical: readonly string[]): number {
  const index = canonical.indexOf(angle);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** A linha de apoio do hodometro, conforme o tipo e o que o servidor sabe. */
export interface OdometerView {
  /** `null` = o motorista ainda nao informou. */
  readonly value: string | null;
  readonly hint: string;
}

export function odometerView(detail: Inspection): OdometerView {
  const value = formatKm(detail.odometerKm);
  if (value === null) {
    return { value: null, hint: 'O motorista informa o hodômetro ao enviar as fotos.' };
  }

  const previous = formatKm(detail.previousOdometerKm);
  const driven = formatKm(detail.kmDriven);

  if (detail.kind === 'CHECKIN' && driven !== null && previous !== null) {
    return { value, hint: `${driven} rodados desde a retirada (${previous}).` };
  }
  if (previous !== null) {
    return { value, hint: `Último registro do veículo: ${previous}.` };
  }
  return { value, hint: '' };
}
