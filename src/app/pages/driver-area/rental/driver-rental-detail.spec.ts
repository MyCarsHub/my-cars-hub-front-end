import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentPreviewService } from '../../../components/document-preview/document-preview.service';
import { ApiErrorService } from '../../../services/api-error.service';
import { DriverRentalChargesService } from '../../../services/driver-rental-charges.service';
import { ExternalNavigationService } from '../../../services/external-navigation.service';
import { NotificationService } from '../../../services/notification.service';
import { DriverCharge } from '../../../types/driver-charges.types';
import {
  RentalDocumentDto,
  RentalListItemDto,
  RentalResponseDto,
} from '../../../types/rental.types';
import { RentalService } from '../../rentals/rental.service';
import { DriverRentalDetail } from './driver-rental-detail';
import { DRIVER_RENTAL_TODAY } from './driver-rental-view';

const flat = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The prototype's day: Saturday, 10/10/2026. */
const TODAY = '2026-10-10';

const RENTAL: RentalResponseDto = {
  id: 'r1',
  vehicleId: 'v1',
  driverId: 'd1',
  startDate: '2026-08-04',
  endDate: '2027-02-03',
  periodRate: 65000,
  totalAmount: 0,
  caucaoAmount: 100000,
  caucaoPaid: false,
  status: 'ACTIVE',
  billingFrequency: 'WEEKLY',
  notes: 'nota do operador que o motorista não vê',
  initialKm: null,
  pickupDate: null,
  firstPaymentDate: '2026-08-04',
  dailyInterestAmount: null,
  lateInterestPercentPerMonth: 1,
  lateFineType: 'PERCENT',
  lateFineValue: 200,
  contractSource: null,
  franchiseKm: 200,
  returnFuelPolicy: 'Mesmo nível da retirada',
  charges: [],
  createdAt: '',
  modifiedAt: '',
};

const ROW: RentalListItemDto = {
  id: 'r1',
  vehicleId: 'v1',
  driverId: 'd1',
  startDate: '2026-08-04',
  endDate: '2027-02-03',
  totalAmount: 0,
  caucaoAmount: 100000,
  status: 'ACTIVE',
  billingFrequency: 'WEEKLY',
  vehiclePlate: 'sjh-2b17',
  vehicleBrand: 'Fiat',
  vehicleModel: 'Mobi',
};

const charge = (over: Partial<DriverCharge> = {}): DriverCharge => ({
  id: 'c',
  kind: 'RENTAL_PERIOD',
  amount: 65000,
  status: 'PENDING',
  dueDate: '2026-10-13',
  periodIndex: 10,
  paidAt: null,
  checkoutUrl: 'https://pay.example/i/1',
  ...over,
});

const weekly = (i: number, dueDate: string, paid: boolean): DriverCharge =>
  charge({
    id: `w${i}`,
    periodIndex: i,
    dueDate,
    status: paid ? 'PAID' : 'PENDING',
    paidAt: paid ? `${dueDate}T10:00:00` : null,
    checkoutUrl: paid ? null : `https://pay.example/i/w${i}`,
  });

/** SJH-2B17 as in the prototype, with week 10 (06/10) unpaid: one overdue, next on 13/10. */
const PROTOTYPE_CHARGES: DriverCharge[] = [
  charge({ id: 'cau', kind: 'CAUCAO', amount: 100000, dueDate: '2026-08-03', status: 'PAID', paidAt: '2026-08-03T09:00:00', periodIndex: null, checkoutUrl: null }),
  weekly(6, '2026-09-15', true),
  weekly(7, '2026-09-22', true),
  weekly(8, '2026-09-29', true),
  weekly(9, '2026-10-06', false),
  weekly(10, '2026-10-13', false),
  weekly(11, '2026-10-20', false),
];

const DOCS: RentalDocumentDto[] = [
  { id: 'd-ck', rentalId: 'r1', kind: 'CHECKIN', mimeType: 'application/pdf', sizeBytes: 1, generated: true, uploadedBy: null, createdDate: '2026-08-04T10:00:00' },
  { id: 'd-ct', rentalId: 'r1', kind: 'CONTRACT', mimeType: 'application/pdf', sizeBytes: 1, generated: true, uploadedBy: null, createdDate: '2026-08-03T10:00:00' },
];

interface Setup {
  rental?: () => Observable<RentalResponseDto>;
  charges?: () => Observable<DriverCharge[]>;
  docs?: () => Observable<RentalDocumentDto[]>;
  cached?: RentalListItemDto[];
}

describe('DriverRentalDetail', () => {
  let fixture: ComponentFixture<DriverRentalDetail>;
  let getById: ReturnType<typeof vi.fn>;
  let chargesCall: ReturnType<typeof vi.fn>;
  let listCall: ReturnType<typeof vi.fn>;
  let previewOpen: ReturnType<typeof vi.fn>;
  let pixCall: ReturnType<typeof vi.fn>;

  const root = () => fixture.nativeElement as HTMLElement;
  const q = (sel: string) => root().querySelector<HTMLElement>(sel);
  const qa = (sel: string) => Array.from(root().querySelectorAll<HTMLElement>(sel));

  function build(setup: Setup = {}): void {
    getById = vi.fn(setup.rental ?? (() => of(RENTAL)));
    chargesCall = vi.fn(setup.charges ?? (() => of(PROTOTYPE_CHARGES)));
    listCall = vi.fn(() => of({ content: [ROW], page: 0, size: 100, total: 1 }));
    previewOpen = vi.fn();
    pixCall = vi.fn(() => of({ payload: '000201PIX', qrCodeBase64: null, expiresAt: null }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        { provide: DRIVER_RENTAL_TODAY, useValue: () => TODAY },
        {
          provide: RentalService,
          useValue: {
            getById,
            items: signal(setup.cached ?? []),
            list: listCall,
            listDocuments: vi.fn(setup.docs ?? (() => of(DOCS))),
            documentSignedUrl: vi.fn(() => of({ url: 'https://storage.example/x', expiresInSeconds: 60 })),
          },
        },
        { provide: DriverRentalChargesService, useValue: { list: chargesCall, pix: pixCall } },
        { provide: DocumentPreviewService, useValue: { open: previewOpen } },
        { provide: ExternalNavigationService, useValue: { openExternal: vi.fn(() => true) } },
        { provide: NotificationService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(DriverRentalDetail);
    fixture.componentRef.setInput('id', 'r1');
    fixture.detectChanges();
    fixture.detectChanges();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.style.overflow = '';
  });

  describe('carga', () => {
    it('lê o aluguel, as cobranças DO MOTORISTA e os documentos do id da rota', () => {
      build();

      expect(getById).toHaveBeenCalledWith('r1');
      expect(chargesCall).toHaveBeenCalledWith('r1');
    });

    it('placa e modelo vêm da linha da lista em memória, sem pedir a lista de novo', () => {
      build({ cached: [ROW] });

      expect(listCall).not.toHaveBeenCalled();
      expect(flat(root())).toContain('SJH-2B17 · Fiat Mobi');
    });

    it('aberto por link: pede a lista do motorista uma vez para achar placa e modelo', () => {
      build();

      expect(listCall).toHaveBeenCalledTimes(1);
      expect(flat(root())).toContain('SJH-2B17 · Fiat Mobi');
    });

    it('esqueleto enquanto o aluguel não chega', () => {
      const pending = new Subject<RentalResponseDto>();
      build({ rental: () => pending });

      expect(q('[data-loading]')).not.toBeNull();
      expect(q('[data-hero]')).toBeNull();
    });

    it('404: diz que não encontrou e não oferece tentar de novo', () => {
      build({ rental: () => throwError(() => new HttpErrorResponse({ status: 404 })) });

      expect(flat(q('[data-load-error]'))).toContain('Não encontramos este aluguel.');
      expect(flat(q('[data-load-error]'))).not.toContain('Tentar novamente');
    });

    it('falha de rede: erro com "Tentar novamente", que refaz a carga', () => {
      let fail = true;
      build({
        rental: () => (fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(RENTAL)),
      });
      expect(q('[data-load-error]')).not.toBeNull();

      fail = false;
      q('[data-load-error] button')!.click();
      fixture.detectChanges();

      expect(q('[data-load-error]')).toBeNull();
      expect(q('[data-hero]')).not.toBeNull();
    });
  });

  describe('o bloco colorido (hero)', () => {
    it('atrasada: rosa, valor, "Venceu em 06/10 (4 dias de atraso)" e "Pagar agora"', () => {
      build();

      const hero = q('[data-hero]')!;
      expect(hero.getAttribute('data-hero')).toBe('overdue');
      expect(hero.className).toContain('bg-rose-700');
      expect(flat(hero.querySelector('[data-hero-value]'))).toBe('R$ 650,00');
      expect(flat(hero)).toContain('Venceu em 06/10 (4 dias de atraso).');
      expect(flat(hero)).toContain('Pode incluir multa e juros por atraso.');
      expect(flat(hero.querySelector('[data-hero-pay]'))).toBe('Pagar agora');
    });

    it('próxima: laranja com "Vence terça, 13/10 · em 3 dias"', () => {
      build({ charges: () => of(PROTOTYPE_CHARGES.filter((c) => c.id !== 'w9')) });

      const hero = q('[data-hero]')!;
      expect(hero.getAttribute('data-hero')).toBe('next');
      expect(hero.className).toContain('bg-primary-700');
      expect(flat(hero)).toContain('Vence terça, 13/10 · em 3 dias');
    });

    it('tudo pago: verde "Tudo em dia", sem botão', () => {
      build({ charges: () => of([weekly(1, '2026-10-06', true)]) });

      const hero = q('[data-hero]')!;
      expect(hero.getAttribute('data-hero')).toBe('clear');
      expect(flat(hero)).toContain('Tudo em dia');
      expect(hero.querySelector('[data-hero-pay]')).toBeNull();
    });

    it('encerrado: cinza "Aluguel encerrado"', () => {
      build({
        rental: () => of({ ...RENTAL, status: 'COMPLETED' }),
        charges: () => of([weekly(1, '2026-07-28', true)]),
      });

      expect(q('[data-hero]')!.getAttribute('data-hero')).toBe('ended');
      expect(flat(q('[data-hero]'))).toContain('Aluguel encerrado');
    });

    it('"Pagar agora" abre o popup da cobrança atrasada', () => {
      build();

      q('[data-hero-pay]')!.click();
      fixture.detectChanges();
      fixture.detectChanges();

      const dialog = q('[role="dialog"]')!;
      expect(flat(dialog)).toContain('Pagar cobrança');
      expect(flat(dialog)).toContain('Aluguel semanal · semana 10 · venceu em 06/10/2026');
      expect(pixCall).toHaveBeenCalledWith('r1', 'w9');
    });
  });

  describe('card "Cobranças"', () => {
    it('recolhido: 2 em aberto + 3 pagas, contagem e "Ver todas as 7 cobranças"', () => {
      build();

      const rows = qa('[data-charge-row]');
      expect(rows).toHaveLength(5);
      expect(flat(q('[data-charge-count]'))).toBe('3 em aberto · 4 pagas');
      expect(flat(q('[data-more]'))).toBe('Ver todas as 7 cobranças');

      expect(rows[0].hasAttribute('data-overdue')).toBe(true);
      expect(flat(rows[0])).toContain('Aluguel semanal · semana 10');
      expect(flat(rows[0])).toContain('Venceu em 06/10/2026');
      expect(flat(rows[0])).toContain('Atrasada');
      expect(flat(rows[1])).toContain('Vence terça, 13/10/2026');
      expect(flat(rows[2])).toContain('Pago · venc. 29/09/2026');
    });

    it('"Ver todas" abre a lista inteira e "Mostrar menos" recolhe', () => {
      build();

      q('[data-more]')!.click();
      fixture.detectChanges();
      expect(qa('[data-charge-row]')).toHaveLength(7);
      expect(flat(q('[data-more]'))).toBe('Mostrar menos');

      q('[data-more]')!.click();
      fixture.detectChanges();
      expect(qa('[data-charge-row]')).toHaveLength(5);
    });

    it('"Pagar" só nas abertas com jeito de pagar, e abre o popup daquela', () => {
      build();

      const buttons = qa('[data-pay]');
      expect(buttons).toHaveLength(2);
      expect(buttons[1].getAttribute('aria-label')).toBe(
        'Pagar Aluguel semanal · semana 11, R$ 650,00',
      );

      buttons[1].click();
      fixture.detectChanges();
      fixture.detectChanges();
      expect(pixCall).toHaveBeenCalledWith('r1', 'w10');
    });

    it('erro nas cobranças: aviso com "Tentar novamente" dentro do card, e sem hero', () => {
      build({ charges: () => throwError(() => new HttpErrorResponse({ status: 500 })) });

      expect(flat(q('[data-charges-error]'))).toContain('Não foi possível carregar as cobranças.');
      expect(q('[data-hero]')).toBeNull();
    });

    it('sem cobrança nenhuma: estado vazio', () => {
      build({ charges: () => of([]) });

      expect(flat(q('[data-charges-empty]'))).toBe('Nenhuma cobrança por enquanto.');
    });

    it('volta à aba depois de pagar: recarrega as cobranças em silêncio', () => {
      build();
      expect(chargesCall).toHaveBeenCalledTimes(1);

      document.dispatchEvent(new Event('visibilitychange'));

      expect(chargesCall).toHaveBeenCalledTimes(2);
    });
  });

  describe('o resto do detalhe', () => {
    it('"O que foi combinado" com os termos do aluguel', () => {
      build();

      const pairs = qa('[data-terms] dt').map((dt) => [
        flat(dt),
        flat(dt.nextElementSibling),
      ]);
      expect(pairs).toContainEqual(['Valor semanal', 'R$ 650,00']);
      expect(pairs).toContainEqual(['Cobrança', 'Toda terça-feira']);
      expect(pairs).toContainEqual(['Atraso no pagamento', 'Multa de 2% + juros de 1% ao mês']);
    });

    it('documentos na ordem contrato → vistoria, e "Abrir" usa o visualizador do app', () => {
      build();

      const rows = qa('[data-doc-row]');
      expect(rows.map((r) => flat(r.querySelector('span.text-sm')))).toEqual([
        'Contrato de locação',
        'Laudo da vistoria de retirada',
      ]);
      rows[0].querySelector<HTMLButtonElement>('[data-doc-open]')!.click();
      expect(previewOpen).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Contrato de locação' }),
      );
    });

    it('reservado: aviso para pagar a caução e fazer a vistoria', () => {
      build({
        rental: () => of({ ...RENTAL, status: 'RESERVED', startDate: '2026-10-20' }),
        charges: () =>
          of([
            charge({ id: 'cau', kind: 'CAUCAO', amount: 100000, dueDate: '2026-10-15', periodIndex: null }),
            weekly(0, '2026-10-20', false),
          ]),
      });

      expect(flat(q('[data-reserved-banner]'))).toContain(
        'Seu aluguel começa em 20/10/2026. Pague a caução e faça a vistoria de retirada',
      );
      expect(flat(q('[data-hero]'))).toContain('Primeira cobrança');
    });

    it('não mostra o que o motorista não alcança: notas do operador, multas e WhatsApp', () => {
      build();

      const text = flat(root());
      expect(text).not.toContain('nota do operador');
      expect(text).not.toContain('Multas do veículo');
      expect(text).not.toContain('WhatsApp');
    });
  });
});
