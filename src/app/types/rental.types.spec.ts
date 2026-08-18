import { describe, expect, it } from 'vitest';

import { RENTAL_PHOTO_ANGLES } from './rental.types';

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
