import { describe, expect, it } from 'vitest';

import {
  INSPECTION_ANGLE_TOTAL,
  buildFrames,
  carName,
  colorAndYear,
  firstName,
  formatDate,
  formatDateTime,
  formatKm,
  formatPhone,
  kindLabel,
  kindWord,
  odometerView,
  pluralize,
  toCardView,
} from './inspection-view';
import { RENTAL_PHOTO_ANGLES } from '../../types/rental.types';
import type {
  Inspection,
  InspectionListItem,
  InspectionPhoto,
} from '../../types/inspection.types';

/**
 * O ADAPTADOR entre o contrato do servidor e as telas de vistoria.
 *
 * O backend das vistorias v2 chegou em paralelo a tela, entao cada campo novo e opcional. O
 * que se prende aqui: a ausencia vira `null` (a tela escreve "—"), nunca zero, e o servidor
 * que renomear um campo quebra UM arquivo, com teste.
 */
describe('inspection-view', () => {
  describe('formatacao', () => {
    it('data: dd/MM/yyyy, e nula para o que nao e data', () => {
      expect(formatDate('2026-10-09T08:42:00')).toBe('09/10/2026');
      expect(formatDate(null)).toBeNull();
      expect(formatDate('')).toBeNull();
      expect(formatDate('nao e data')).toBeNull();
    });

    it('data pura (yyyy-MM-dd) e o MESMO dia, sem escorregar pelo fuso', () => {
      expect(formatDate('2026-10-25')).toBe('25/10/2026');
      expect(formatDate('2026-01-01')).toBe('01/01/2026');
    });

    it('data e hora: dd/MM/yyyy HH:mm', () => {
      expect(formatDateTime('2026-10-09T08:42:00')).toBe('09/10/2026 08:42');
      expect(formatDateTime('2026-10-09T00:05:00')).toBe('09/10/2026 00:05');
      expect(formatDateTime(undefined)).toBeNull();
    });

    it('km: ponto de milhar pt-BR e a unidade; nulo para ausente', () => {
      expect(formatKm(82109)).toBe('82.109 km');
      expect(formatKm(999)).toBe('999 km');
      expect(formatKm(1234567)).toBe('1.234.567 km');
      expect(formatKm(null)).toBeNull();
      expect(formatKm(undefined)).toBeNull();
    });

    it('zero km e uma afirmacao, nao ausencia', () => {
      expect(formatKm(0)).toBe('0 km');
    });

    it('telefone: mascara 10 e 11 digitos; o resto passa como veio', () => {
      expect(formatPhone('11981234567')).toBe('(11) 98123-4567');
      expect(formatPhone('1134567890')).toBe('(11) 34567-890');
      expect(formatPhone('+55 11 98123-4567')).toBe('+55 11 98123-4567');
      expect(formatPhone('  ')).toBeNull();
      expect(formatPhone(null)).toBeNull();
    });

    it('plural resolvido, nunca "vistoria(s)"', () => {
      expect(pluralize(1, 'vistoria', 'vistorias')).toBe('1 vistoria');
      expect(pluralize(0, 'vistoria', 'vistorias')).toBe('0 vistorias');
      expect(pluralize(14, 'foto', 'fotos')).toBe('14 fotos');
    });

    it('primeiro nome', () => {
      expect(firstName('Carlos Henrique Souza')).toBe('Carlos');
      expect(firstName('  Ana  ')).toBe('Ana');
      expect(firstName('')).toBeNull();
      expect(firstName(null)).toBeNull();
    });

    it('tipo: retirada, devolucao e frota', () => {
      expect(kindLabel('CHECKOUT')).toBe('Retirada');
      expect(kindLabel('CHECKIN')).toBe('Devolução');
      expect(kindWord('CHECKOUT')).toBe('retirada');
      expect(kindWord('CHECKIN')).toBe('devolução');
      expect(kindWord('FLEET')).toBe('frota');
    });

    it('nome do carro e cor/ano, cada metade opcional', () => {
      expect(carName({ vehicleBrand: 'Fiat', vehicleModel: 'Mobi Like 1.0' })).toBe(
        'Fiat Mobi Like 1.0',
      );
      expect(carName({ vehicleModel: 'Mobi' })).toBe('Mobi');
      expect(carName({})).toBeNull();
      expect(colorAndYear({ vehicleYear: 2023, vehicleColor: 'Branco' })).toBe('2023 · Branco');
      expect(colorAndYear({ vehicleColor: 'Branco' })).toBe('Branco');
      expect(colorAndYear({ vehicleYear: 2023 })).toBe('2023');
      expect(colorAndYear({})).toBeNull();
    });
  });

  describe('toCardView', () => {
    const base: InspectionListItem = {
      id: 'i1',
      rentalId: 'r1',
      vehicleId: 'v1',
      kind: 'CHECKOUT',
      performedAt: '2026-10-09T08:42:00',
      status: 'SUBMITTED',
    };

    it('o denominador e 14 e menos de 14 e incompleto', () => {
      expect(INSPECTION_ANGLE_TOTAL).toBe(14);
      expect(toCardView({ ...base, photoCount: 9 }).photos).toEqual({
        got: 9,
        total: 14,
        incomplete: true,
      });
      expect(toCardView({ ...base, photoCount: 14 }).photos?.incomplete).toBe(false);
    });

    it('sem contagem do servidor nao ha contagem — nem zero', () => {
      expect(toCardView(base).photos).toBeNull();
      expect(toCardView({ ...base, photoCount: 0 }).photos?.got).toBe(0);
    });

    it('sem placa cai em "Veículo não identificado"; foto vazia vira null', () => {
      const view = toCardView({ ...base, vehiclePlate: '  ', frontPhotoUrl: '' });

      expect(view.plate).toBe('Veículo não identificado');
      expect(view.frontPhotoUrl).toBeNull();
      expect(view.model).toBeNull();
      expect(view.driver).toBeNull();
    });
  });

  describe('buildFrames', () => {
    const photo = (angle: string, n: number, signedUrl: string | null = `u${n}`): InspectionPhoto => ({
      id: `p${n}`,
      inspectionId: 'i1',
      angle,
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      signedUrl,
      createdDate: '2026-10-09T08:40:00',
    });
    const canonical = RENTAL_PHOTO_ANGLES.map((a) => a.value as string);

    it('sem fotos: 14 quadros vazios na ordem do roteiro', () => {
      const frames = buildFrames([], null);

      expect(frames.map((f) => f.angle)).toEqual(canonical);
      expect(frames.every((f) => !f.hasPhoto && f.signedUrl === null)).toBe(true);
    });

    it('uma foto marca so o quadro do angulo dela, com URL e data', () => {
      const frames = buildFrames([photo('ODOMETER', 1)], canonical);
      const odometer = frames.find((f) => f.angle === 'ODOMETER')!;

      expect(odometer).toMatchObject({
        hasPhoto: true,
        signedUrl: 'u1',
        photoId: 'p1',
        label: 'Hodômetro',
        takenAt: '09/10/2026 08:40',
      });
      expect(frames.filter((f) => f.hasPhoto).length).toBe(1);
    });

    it('foto que EXISTE sem URL assinada continua um quadro "com foto"', () => {
      const [front] = buildFrames([photo('FRONT', 1, null)], canonical);

      expect(front.hasPhoto).toBe(true);
      expect(front.signedUrl).toBeNull();
    });

    it('a ordem do servidor nao manda', () => {
      const frames = buildFrames([photo('REAR_SEAT', 1), photo('FRONT', 2)], canonical);

      expect(frames[0].angle).toBe('FRONT');
      expect(frames[13].angle).toBe('REAR_SEAT');
    });

    it('apelido legado *_PANEL cai no quadro do pneu', () => {
      const frames = buildFrames([photo('REAR_RIGHT_PANEL', 1)], canonical);

      expect(frames.length).toBe(14);
      expect(frames.find((f) => f.angle === 'REAR_RIGHT_TIRE')?.hasPhoto).toBe(true);
    });

    it('angulo fora do roteiro vai para o fim, sem se intercalar', () => {
      const frames = buildFrames([photo('CUSTOM_ROOF', 1)], canonical);

      expect(frames.length).toBe(15);
      expect(frames[14].angle).toBe('CUSTOM_ROOF');
      expect(frames[14].hasPhoto).toBe(true);
    });

    it('o roteiro retratado manda: empresa com 3 angulos ve 3 quadros', () => {
      const frames = buildFrames([], ['BACK', 'FRONT', 'ENGINE']);

      expect(frames.map((f) => f.angle)).toEqual(['FRONT', 'BACK', 'ENGINE']);
    });
  });

  describe('odometerView', () => {
    const base: Inspection = {
      id: 'i1',
      companyId: 'c',
      vehicleId: 'v',
      rentalId: 'r',
      kind: 'CHECKOUT',
      performedBy: null,
      performedAt: '2026-10-09T08:42:00',
      requiredAngles: [],
      capturedAngles: [],
    };

    it('retirada: ultimo registro do veiculo', () => {
      expect(odometerView({ ...base, odometerKm: 82109, previousOdometerKm: 81420 })).toEqual({
        value: '82.109 km',
        hint: 'Último registro do veículo: 81.420 km.',
      });
    });

    it('devolucao: km rodados desde a retirada, com o km da retirada', () => {
      expect(
        odometerView({
          ...base,
          kind: 'CHECKIN',
          odometerKm: 82109,
          previousOdometerKm: 81420,
          kmDriven: 689,
        }),
      ).toEqual({
        value: '82.109 km',
        hint: '689 km rodados desde a retirada (81.420 km).',
      });
    });

    it('devolucao sem km rodado calculado cai no ultimo registro, sem inventar a conta', () => {
      expect(
        odometerView({ ...base, kind: 'CHECKIN', odometerKm: 82109, previousOdometerKm: 81420 }).hint,
      ).toBe('Último registro do veículo: 81.420 km.');
    });

    it('sem registro anterior nao ha linha de apoio', () => {
      expect(odometerView({ ...base, odometerKm: 100 })).toEqual({ value: '100 km', hint: '' });
    });

    it('sem hodometro: valor nulo e a instrucao', () => {
      expect(odometerView({ ...base, odometerKm: null })).toEqual({
        value: null,
        hint: 'O motorista informa o hodômetro ao enviar as fotos.',
      });
    });
  });
});
