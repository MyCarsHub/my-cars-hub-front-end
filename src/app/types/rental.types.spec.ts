import { describe, expect, it } from 'vitest';

import { RENTAL_PHOTO_ANGLES, chargeStatusInfo } from './rental.types';
import type { ChargeStatus } from './rental.types';

/**
 * Os `value` de {@link RENTAL_PHOTO_ANGLES} são contrato com a API: viram o
 * path param do upload e a chave que casa a foto com o slot no retorno. Trocar
 * um deles sem o backend correspondente faz o slot aparecer "sem foto" mesmo
 * com a imagem gravada. A ordem também é contrato — define o grid da tela e o
 * grid do PDF gerado pelo backend (`RentalPhotoAngleEnum`).
 */
describe('RENTAL_PHOTO_ANGLES', () => {
  it('mantém as 14 chaves na ordem canônica do enum do backend', () => {
    expect(RENTAL_PHOTO_ANGLES.map((a) => a.value)).toEqual([
      'FRONT',
      'BACK',
      'LEFT',
      'RIGHT',
      'FRONT_LEFT_TIRE',
      'FRONT_RIGHT_TIRE',
      'REAR_LEFT_TIRE',
      'REAR_RIGHT_TIRE',
      'ENGINE',
      'TRUNK',
      'DASHBOARD',
      'ODOMETER',
      'FRONT_SEAT',
      'REAR_SEAT',
    ]);
  });

  it('não reintroduz nenhuma das quatro chaves antigas de "painel" de carroceria', () => {
    const values: string[] = RENTAL_PHOTO_ANGLES.map((a) => a.value);
    expect(values).not.toContain('FRONT_LEFT_PANEL');
    expect(values).not.toContain('FRONT_RIGHT_PANEL');
    expect(values).not.toContain('REAR_LEFT_PANEL');
    expect(values).not.toContain('REAR_RIGHT_PANEL');
  });

  it('rotula os quatro cantos como pneus, não como painéis de carroceria', () => {
    const labelOf = (value: string): string | undefined =>
      RENTAL_PHOTO_ANGLES.find((a) => a.value === value)?.label;

    expect(labelOf('FRONT_LEFT_TIRE')).toBe('Pneu dianteiro esquerdo');
    expect(labelOf('FRONT_RIGHT_TIRE')).toBe('Pneu dianteiro direito');
    expect(labelOf('REAR_LEFT_TIRE')).toBe('Pneu traseiro esquerdo');
    expect(labelOf('REAR_RIGHT_TIRE')).toBe('Pneu traseiro direito');
  });

  it('preserva o painel de instrumentos, o único "painel" legítimo', () => {
    expect(RENTAL_PHOTO_ANGLES.find((a) => a.value === 'DASHBOARD')?.label).toBe('Painel');
  });
});

/**
 * Guarda de exaustividade do mapa de chips de cobrança.
 *
 * `CHARGE_STATUS_META` é module-private e indexado por `Record<ChargeStatus, …>`:
 * um status que exista no enum do backend mas falte na união do frontend não dá
 * erro de compilação em lugar nenhum — ele simplesmente devolve `undefined` no
 * `chargeStatusInfo`, e a tela de detalhes do aluguel quebra na detecção de
 * mudanças ao ler `.label`/`.chip`. Foi exatamente assim que `DISPUTED` passou
 * (FIX-0190 / FIX-0122).
 *
 * `ALL_CHARGE_STATUSES` é um `Record<ChargeStatus, true>` de propósito: quando
 * alguém acrescentar o nono status à união, ESTE arquivo para de compilar até
 * que o mapa e este teste sejam atualizados juntos. É a única forma de tornar
 * uma união de tipos verificável em runtime.
 */
describe('CHARGE_STATUS_META (via chargeStatusInfo)', () => {
  const ALL_CHARGE_STATUSES: Record<ChargeStatus, true> = {
    PENDING: true,
    PAID: true,
    PAST_DUE: true,
    FAILED: true,
    CANCELED: true,
    REFUNDED: true,
    RELEASED: true,
    DISPUTED: true,
  };

  /** `dueDate` nulo nunca deriva atraso, então cada status se mapeia em si mesmo. */
  const TODAY = '2026-08-25';

  it('cobre os 8 status do enum do backend, sem nenhum undefined', () => {
    const statuses = Object.keys(ALL_CHARGE_STATUSES) as ChargeStatus[];
    expect(statuses).toHaveLength(8);

    for (const status of statuses) {
      const info = chargeStatusInfo({ status, dueDate: null }, TODAY);
      expect(info, `status ${status} sem entrada no mapa`).toBeDefined();
      expect(info.label, `status ${status} sem rótulo`).toBeTruthy();
      expect(info.chip, `status ${status} sem chip`).toMatch(/^bg-\S+\s+text-\S+$/);
    }
  });

  it('dá a DISPUTED o rótulo em português e o par roxo que passa AA (5.99:1)', () => {
    expect(chargeStatusInfo({ status: 'DISPUTED', dueDate: null }, TODAY)).toEqual({
      label: 'Contestada',
      chip: 'bg-purple-100 text-purple-700',
    });
  });

  it('não confunde DISPUTED com atraso, por mais vencida que esteja a data', () => {
    expect(chargeStatusInfo({ status: 'DISPUTED', dueDate: '2020-01-05' }, TODAY).label).toBe(
      'Contestada',
    );
  });
});
