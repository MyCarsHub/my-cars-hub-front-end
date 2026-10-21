import { InjectionToken } from '@angular/core';
import { INSPECTION_ODOMETER_MAX_KM } from '../../../types/inspection.types';
import { formatPtBrNumber } from '../../../utils/ptbr-number';

/**
 * Where the inspection screens live. Production is always `/vistorias`; the local demo mounts
 * the same pages under another prefix and provides its own value, so every link the driver
 * screens build stays inside the tree that rendered them.
 */
export const INSPECTIONS_ROOT = new InjectionToken<string>('INSPECTIONS_ROOT', {
  providedIn: 'root',
  factory: () => '/vistorias',
});

/** What the guided capture tells the driver for one angle: what to frame and how. */
export interface AngleGuide {
  /** Completes "Enquadre … dentro das marcas". */
  readonly frame: string;
  readonly tip: string;
}

const TIRE: AngleGuide = {
  frame: 'o pneu e a roda',
  tip: 'Chegue perto até o pneu e a roda ocuparem o quadro.',
};

/** The owner's prototype copy, per angle code of the server's script. */
const GUIDES: Readonly<Record<string, AngleGuide>> = {
  FRONT: {
    frame: 'a frente do carro',
    tip: 'Fique a uns 3 metros, de frente, com o carro inteiro no quadro.',
  },
  BACK: {
    frame: 'a traseira do carro',
    tip: 'Fique a uns 3 metros, atrás do carro, com a placa visível.',
  },
  LEFT: {
    frame: 'a lateral esquerda',
    tip: 'Posicione-se de lado e enquadre do para-choque dianteiro ao traseiro.',
  },
  RIGHT: {
    frame: 'a lateral direita',
    tip: 'Posicione-se do outro lado e enquadre o carro inteiro.',
  },
  FRONT_LEFT_TIRE: TIRE,
  FRONT_RIGHT_TIRE: TIRE,
  REAR_LEFT_TIRE: TIRE,
  REAR_RIGHT_TIRE: TIRE,
  ENGINE: { frame: 'o motor', tip: 'Abra o capô e fotografe o motor por cima, com boa luz.' },
  TRUNK: { frame: 'o porta-malas', tip: 'Abra o porta-malas e fotografe o interior inteiro.' },
  DASHBOARD: {
    frame: 'o painel',
    tip: 'Ligue o carro e fotografe o painel com os avisos visíveis.',
  },
  ODOMETER: {
    frame: 'os números do hodômetro',
    tip: 'Foto nítida dos quilômetros. Os números precisam estar legíveis.',
  },
  FRONT_SEAT: {
    frame: 'os bancos da frente',
    tip: 'Fotografe os bancos da frente pela porta aberta.',
  },
  REAR_SEAT: {
    frame: 'o banco de trás',
    tip: 'Fotografe o banco traseiro inteiro pela porta aberta.',
  },
};

/**
 * The guide for an angle. The script is configurable per company, so an angle the prototype
 * never named still gets a sentence built from its label instead of an empty hint.
 */
export function angleGuide(angle: string, label: string): AngleGuide {
  return (
    GUIDES[angle] ?? {
      frame: label.toLowerCase(),
      tip: `Fotografe ${label.toLowerCase()} com boa luz e sem reflexo.`,
    }
  );
}

/** Keeps only digits (at most 7) and writes them with the pt-BR thousands dot: `42.318`. */
export function maskKm(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
  return digits === '' ? '' : formatPtBrNumber(Number(digits), 0);
}

/** The masked text back to an integer; `null` when there is nothing to read. */
export function parseKm(masked: string): number | null {
  const digits = masked.replace(/\D/g, '');
  return digits === '' ? null : Number(digits);
}

/**
 * Why an odometer reading cannot be sent, or `null` when it can. The lower bound is the
 * vehicle's last record (the prototype's rule); the upper bound is the server's ceiling.
 */
export function kmProblem(km: number | null, previousKm: number | null): string | null {
  if (km === null) return 'Informe a quilometragem do hodômetro.';
  if (km < 1) return 'O hodômetro precisa ser maior que zero.';
  if (km > INSPECTION_ODOMETER_MAX_KM) {
    return 'Esse valor passa do limite de 5.000.000 km. Confira o número.';
  }
  if (previousKm !== null && km < previousKm) {
    return (
      `O valor é menor que o último registro (${formatPtBrNumber(previousKm, 0)} km). ` +
      'Confira o número no painel.'
    );
  }
  return null;
}
