import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectionReview } from './inspection-review';
import { ApiErrorService } from '../../services/api-error.service';
import { DocumentPreviewService } from '../../components/document-preview/document-preview.service';
import { InspectionsService } from '../../services/inspections.service';
import { NotificationService } from '../../services/notification.service';
import { SessionService } from '../../services/session.service';
import type {
  Inspection,
  InspectionPhoto,
  InspectionReviewResult,
} from '../../types/inspection.types';
import { RENTAL_PHOTO_ANGLES } from '../../types/rental.types';

/**
 * `/vistorias/:id` — os DETALHES da vistoria e, para quem decide, a decisao.
 *
 * E a aprovacao — nao o envio — que fecha a ocorrencia do ciclo. Os invariantes, em ordem de
 * risco:
 *
 * 1. NAO SE APROVA SEM VER NEM SEM HODOMETRO. Sem as 14 fotos visiveis e o km informado, o
 *    botao fica desabilitado e a tela diz por que — aprovar as cegas e assinar em branco.
 * 2. RECUSA EXIGE MOTIVO na tela, nao so no servidor, e pede confirmacao.
 * 3. O MOTORISTA NAO DECIDE. O servidor ja barra; aqui e defesa em profundidade.
 * 4. A URL ASSINADA EXPIRA. Imagem quebrada nao e estado final: a tela RECARREGA a lista.
 * 5. FALHAR NAO E DECIDIR. Se aprovar ou recusar falhar, a tela nao afirma que decidiu e o
 *    motivo digitado fica.
 * 6. A foto SEM URL nao some: o quadro existe, diz o angulo e o aviso oferece tentar de novo.
 */
describe('InspectionReview — detalhes da vistoria', () => {
  const ANGLES = RENTAL_PHOTO_ANGLES.map((a) => a.value as string);

  /** Uma foto por angulo, na forma EXATA do DTO real (sem `storagePath`). */
  function photoFor(angle: string, n: number, signedUrl: string | null = null): InspectionPhoto {
    return {
      id: `ph-${n}`,
      inspectionId: 'insp-1',
      angle,
      mimeType: 'image/jpeg',
      sizeBytes: 180_000,
      signedUrl: signedUrl ?? `https://cdn.example/${angle.toLowerCase()}.jpg?sig=${n}`,
      createdDate: '2026-10-09T08:40:00',
    };
  }

  const ALL_PHOTOS: InspectionPhoto[] = ANGLES.map((angle, n) => photoFor(angle, n));

  const DETAIL: Inspection = {
    id: 'insp-1',
    companyId: 'co-1',
    vehicleId: 'veh-1',
    rentalId: 'alg_01J9Z4K7QX2M',
    kind: 'CHECKOUT',
    performedBy: 'user-1',
    performedAt: '2026-10-09T08:42:00',
    requiredAngles: ANGLES,
    capturedAngles: ANGLES,
    status: 'SUBMITTED',
    vehiclePlate: 'SJH2B17',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Mobi Like 1.0',
    vehicleColor: 'Branco',
    vehicleYear: 2023,
    driverName: 'Carlos Henrique Souza',
    driverPhone: '11981234567',
    photoCount: 14,
    odometerKm: 82109,
    previousOdometerKm: 81420,
    kmDriven: 689,
  };

  const APPROVED: InspectionReviewResult = {
    id: 'insp-1',
    status: 'APPROVED',
    scheduleId: 'sch-1',
    dueAt: '2026-10-01T00:00:00',
    pdfDocumentId: null,
    supersedesId: null,
  };
  const REJECTED: InspectionReviewResult = { ...APPROVED, status: 'REJECTED' };

  let getOne: ReturnType<typeof vi.fn>;
  let photos: ReturnType<typeof vi.fn>;
  let approve: ReturnType<typeof vi.fn>;
  let reject: ReturnType<typeof vi.fn>;
  let reportUrl: ReturnType<typeof vi.fn>;
  let previewOpen: ReturnType<typeof vi.fn>;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let notifications: NotificationService;
  let role: string;

  function configure(): void {
    TestBed.resetTestingModule();
    getOne = vi.fn().mockReturnValue(of(DETAIL));
    photos = vi.fn().mockReturnValue(of(ALL_PHOTOS));
    approve = vi.fn().mockReturnValue(of(APPROVED));
    reject = vi.fn().mockReturnValue(of(REJECTED));
    reportUrl = vi.fn().mockReturnValue(of({ url: 'https://storage.example/laudo.pdf?sig=1' }));
    previewOpen = vi.fn();
    params = new BehaviorSubject(convertToParamMap({ id: 'insp-1' }));

    TestBed.configureTestingModule({
      imports: [InspectionReview],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: InspectionsService,
          useValue: { getOne, photos, approve, reject, reportUrl },
        },
        { provide: SessionService, useValue: { getCompanyRoleFromToken: () => role } },
        { provide: DocumentPreviewService, useValue: { open: previewOpen } },
        { provide: ActivatedRoute, useValue: { paramMap: params } },
      ],
    });
    notifications = TestBed.inject(NotificationService);
  }

  function render(): ComponentFixture<InspectionReview> {
    const fixture = TestBed.createComponent(InspectionReview);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  /** Pinta uma vistoria especifica, com as fotos que o teste escolher. */
  function renderWith(
    detail: Partial<Inspection> = {},
    photoList: InspectionPhoto[] = ALL_PHOTOS,
  ): ComponentFixture<InspectionReview> {
    getOne.mockReturnValue(of({ ...DETAIL, ...detail }));
    photos.mockReturnValue(of(photoList));
    return render();
  }

  const host = (f: ComponentFixture<InspectionReview>) => f.nativeElement as HTMLElement;
  const text = (f: ComponentFixture<InspectionReview>) =>
    (host(f).textContent ?? '').replace(/\s+/g, ' ');
  const q = <T extends Element = HTMLElement>(f: ComponentFixture<InspectionReview>, s: string) =>
    host(f).querySelector<T>(s);
  const approveBtn = (f: ComponentFixture<InspectionReview>) =>
    q<HTMLButtonElement>(f, '[data-approve]');
  const field = (f: ComponentFixture<InspectionReview>, name: string) =>
    (q(f, `[data-field="${name}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const frames = (f: ComponentFixture<InspectionReview>) =>
    Array.from(host(f).querySelectorAll<HTMLElement>('[data-frame]'));

  function button(f: ComponentFixture<InspectionReview>, label: string): HTMLButtonElement {
    const found = Array.from(host(f).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    );
    if (!found) throw new Error(`botao "${label}" nao esta na tela`);
    return found;
  }

  function typeReason(f: ComponentFixture<InspectionReview>, value: string): void {
    const input = q<HTMLTextAreaElement>(f, '[data-reject-reason]');
    if (!input) throw new Error('campo de motivo nao renderizado');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  /** Abre o motivo, escreve e pede a recusa — o caminho ate o dialogo de confirmacao. */
  function askToReject(f: ComponentFixture<InspectionReview>, reason = 'Foto do painel desfocada.') {
    button(f, 'Recusar').click();
    f.detectChanges();
    typeReason(f, reason);
    button(f, 'Recusar e pedir nova vistoria').click();
    f.detectChanges();
  }

  const confirmDialog = (f: ComponentFixture<InspectionReview>) =>
    host(f).querySelector('app-confirm-dialog [role="dialog"]');

  beforeEach(() => {
    sessionStorage.clear();
    role = 'OWNER';
    configure();
  });

  // ==================================================================== cabecalho

  describe('cabecalho', () => {
    it('le o id da ROTA e busca a vistoria e as fotos dela', () => {
      render();

      expect(getOne).toHaveBeenCalledWith('insp-1');
      expect(photos).toHaveBeenCalledWith('insp-1');
    });

    it('tem o voltar, o titulo, o chip de situacao e o subtitulo com a data', () => {
      const fixture = render();

      const back = q<HTMLAnchorElement>(fixture, '[data-back]')!;
      expect(back.getAttribute('href')).toBe('/vistorias');
      expect(back.textContent?.trim()).toBe('Vistorias');
      expect(back.className).toContain('min-h-[44px]');

      expect(q(fixture, 'h1')?.textContent?.trim()).toBe('Detalhes da vistoria');
      expect(q(fixture, '[data-status-chip]')?.textContent?.trim()).toBe('Aguardando aprovação');
      expect(q(fixture, '[data-status-chip]')?.className).toContain('bg-amber-100');
      expect(text(fixture)).toContain('Retirada realizada em 09/10/2026 08:42.');
    });

    it('o chip fica AO LADO do titulo, no mesmo bloco do h1', () => {
      const fixture = render();
      const heading = q(fixture, 'h1')!;

      expect(heading.parentElement).toBe(q(fixture, '[data-status-chip]')!.parentElement);
    });

    it('devolucao diz "Devolução realizada em"', () => {
      const fixture = renderWith({ kind: 'CHECKIN' });

      expect(text(fixture)).toContain('Devolução realizada em 09/10/2026 08:42.');
    });

    it('enquanto carrega mostra o esqueleto e nao um zero', () => {
      getOne.mockReturnValue(new Subject<Inspection>());
      const fixture = render();

      expect(q(fixture, '[data-skeleton]')).not.toBeNull();
      expect(q(fixture, '[data-status-chip]')).toBeNull();
      expect(q(fixture, '[data-summary]')).toBeNull();
    });

    it('se a leitura falha, diz o que houve e o retry le de novo', () => {
      getOne.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 404, error: { message: 'Vistoria não encontrada.' } })),
      );
      const fixture = render();

      expect(text(fixture)).toContain('Vistoria não encontrada.');
      expect(q(fixture, '[data-summary]')).toBeNull();

      getOne.mockReturnValue(of(DETAIL));
      q<HTMLButtonElement>(fixture, '[data-retry-detail]')?.click();
      fixture.detectChanges();

      expect(getOne).toHaveBeenCalledTimes(2);
      expect(q(fixture, '[data-summary]')).not.toBeNull();
    });

    it('navegar para outra vistoria na mesma instancia le a nova', () => {
      const fixture = render();

      params.next(convertToParamMap({ id: 'insp-2' }));
      fixture.detectChanges();

      expect(getOne).toHaveBeenLastCalledWith('insp-2');
      expect(photos).toHaveBeenLastCalledWith('insp-2');
    });
  });

  // ================================================================== as faixas

  describe('faixas por situacao', () => {
    it('REJECTED: faixa rose com o motivo, e role=alert', () => {
      const fixture = renderWith({
        status: 'REJECTED',
        rejectionReason: 'A foto do hodômetro está desfocada.',
      });
      const strip = q(fixture, '[data-rejected-strip]')!;

      expect(strip.getAttribute('role')).toBe('alert');
      expect(strip.className).toContain('bg-rose-50');
      expect(strip.className).toContain('border-rose-200');
      expect(strip.className).toContain('rounded-2xl');
      expect(strip.textContent).toContain('Vistoria recusada. O motorista precisa refazer.');
      expect(q(fixture, '[data-rejection-reason]')?.textContent?.trim()).toBe(
        'Motivo: A foto do hodômetro está desfocada.',
      );
    });

    it('REJECTED sem motivo nao inventa um', () => {
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: null });

      expect(q(fixture, '[data-rejected-strip]')).not.toBeNull();
      expect(q(fixture, '[data-rejection-reason]')).toBeNull();
    });

    it('PENDING: banner de informacao com o primeiro nome e a contagem', () => {
      const fixture = renderWith(
        { status: 'PENDING', odometerKm: null },
        ALL_PHOTOS.slice(0, 9),
      );

      expect(text(fixture)).toContain(
        'Aguardando Carlos enviar as 14 fotos e o hodômetro pelo celular (9/14).',
      );
      expect(q(fixture, 'app-alert-banner')?.querySelector('[role="status"]')).not.toBeNull();
      expect(q(fixture, '[data-rejected-strip]')).toBeNull();
    });

    it('SUBMITTED e APPROVED nao tem faixa', () => {
      for (const status of ['SUBMITTED', 'APPROVED'] as const) {
        configure();
        const fixture = renderWith({ status });
        expect(q(fixture, '[data-rejected-strip]'), status).toBeNull();
        expect(text(fixture), status).not.toContain('Aguardando Carlos enviar');
      }
    });

    it('o dono NAO e convidado a "continuar" a vistoria do motorista', () => {
      const fixture = renderWith({ status: 'PENDING', odometerKm: null }, ALL_PHOTOS.slice(0, 9));

      expect(q(fixture, '[data-continue]')).toBeNull();
    });

    it('vistoria de FROTA em andamento oferece continuar a captura', () => {
      const fixture = renderWith({ status: 'PENDING', kind: 'FLEET', rentalId: null });

      expect(q<HTMLAnchorElement>(fixture, '[data-continue]')?.getAttribute('href')).toBe(
        '/vistorias/insp-1/captura',
      );
    });
  });

  // =================================================================== o Resumo

  describe('card Resumo', () => {
    it('mostra veiculo, cor e ano, motorista e contato', () => {
      const fixture = render();

      expect(field(fixture, 'vehicle')).toBe('SJH2B17 · Fiat Mobi Like 1.0');
      expect(field(fixture, 'color-year')).toBe('2023 · Branco');
      expect(field(fixture, 'driver')).toBe('Carlos Henrique Souza');
      expect(field(fixture, 'phone')).toBe('(11) 98123-4567');
    });

    it('a placa e mono e SEM retangulo ao redor', () => {
      const fixture = render();
      const plate = q(fixture, '[data-field="vehicle"] span')!;

      expect(plate.className).toContain('font-mono');
      expect(plate.className).not.toMatch(/\b(border|bg-|rounded|ring)/);
    });

    it('o ID do aluguel e mono e leva ao aluguel', () => {
      const fixture = render();
      const link = q<HTMLAnchorElement>(fixture, '[data-rental-link]')!;

      expect(field(fixture, 'rental')).toContain('alg_01J9Z4K7QX2M');
      expect(q(fixture, '[data-field="rental"] span')?.className).toContain('font-mono');
      expect(link.getAttribute('href')).toBe('/alugueis/alg_01J9Z4K7QX2M');
      expect(link.textContent?.trim()).toBe('Ver aluguel');
      expect(link.className).toContain('text-primary-700');
    });

    it('vistoria de frota nao tem aluguel: diz isso e nao oferece o link', () => {
      const fixture = renderWith({ kind: 'FLEET', rentalId: null });

      expect(field(fixture, 'rental')).toContain('Vistoria de frota, sem aluguel.');
      expect(q(fixture, '[data-rental-link]')).toBeNull();
    });

    it('retirada: hodometro em mono e o ultimo registro do veiculo', () => {
      const fixture = render();

      expect(q(fixture, '[data-odometer-value]')?.textContent?.trim()).toBe('82.109 km');
      expect(q(fixture, '[data-odometer-value]')?.className).toContain('font-mono');
      expect(q(fixture, '[data-odometer-hint]')?.textContent?.trim()).toBe(
        'Último registro do veículo: 81.420 km.',
      );
    });

    it('devolucao: quantos km rodou desde a retirada, com o km da retirada', () => {
      const fixture = renderWith({ kind: 'CHECKIN' });

      expect(q(fixture, '[data-odometer-hint]')?.textContent?.trim()).toBe(
        '689 km rodados desde a retirada (81.420 km).',
      );
    });

    it('sem hodometro: "Aguardando o motorista" e a instrucao, nunca 0 km', () => {
      const fixture = renderWith({
        status: 'PENDING',
        odometerKm: null,
        previousOdometerKm: null,
        kmDriven: null,
      });

      expect(q(fixture, '[data-odometer-value]')?.textContent?.trim()).toBe('Aguardando o motorista');
      expect(q(fixture, '[data-odometer-value]')?.className).toContain('text-neutral-500');
      expect(q(fixture, '[data-odometer-hint]')?.textContent?.trim()).toBe(
        'O motorista informa o hodômetro ao enviar as fotos.',
      );
      expect(text(fixture)).not.toContain('0 km');
    });

    it('o servidor que nao manda os campos novos degrada para "—", sem undefined', () => {
      const bare: Partial<Inspection> = {
        vehiclePlate: undefined,
        vehicleBrand: undefined,
        vehicleModel: undefined,
        vehicleColor: undefined,
        vehicleYear: undefined,
        driverName: undefined,
        driverPhone: undefined,
        odometerKm: undefined,
        previousOdometerKm: undefined,
        kmDriven: undefined,
      };
      const fixture = renderWith(bare);

      for (const name of ['vehicle', 'color-year', 'driver', 'phone']) {
        expect(field(fixture, name), name).toBe('—');
      }
      expect(text(fixture)).not.toContain('undefined');
      expect(text(fixture)).not.toContain('null');
    });

    it('a grade e auto-fit de 200px', () => {
      const fixture = render();

      expect(q(fixture, '[data-summary]')?.className).toContain(
        'grid-cols-[repeat(auto-fit,minmax(200px,1fr))]',
      );
    });
  });

  // ================================================================ as 14 fotos

  describe('galeria', () => {
    it('titula pelo tipo e conta os angulos enviados', () => {
      const fixture = render();

      expect(text(fixture)).toContain('Vistoria de retirada');
      expect(q(fixture, '[data-photo-summary]')?.textContent?.trim()).toBe(
        '14 de 14 ângulos enviados. O laudo em PDF é gerado a partir dessas fotos.',
      );
    });

    it('devolucao titula "Vistoria de devolução"', () => {
      const fixture = renderWith({ kind: 'CHECKIN' });

      expect(text(fixture)).toContain('Vistoria de devolução');
    });

    it('sao 14 quadros quadrados, tracejados, na ordem do roteiro', () => {
      const fixture = render();
      const list = frames(fixture);

      expect(list.length).toBe(14);
      for (const el of list) {
        expect(el.className).toContain('aspect-square');
        expect(el.className).toContain('border-dashed');
        expect(el.className).toContain('rounded-xl');
      }
      expect(q(fixture, '[data-frame]')?.closest('ul')?.className).toContain(
        'grid-cols-[repeat(auto-fill,minmax(140px,1fr))]',
      );

      const labels = list.map((el) => (el.textContent ?? '').trim());
      expect(labels[0]).toBe('Frente');
      expect(labels[1]).toBe('Traseira');
      expect(labels[13]).toBe('Banco traseiro');
    });

    it('com foto: a imagem cobre o quadro, o angulo vai na faixa e e um botao "Ampliar foto"', () => {
      const fixture = render();
      const first = frames(fixture)[0];
      const img = first.querySelector('img')!;

      expect(first.tagName).toBe('BUTTON');
      expect(first.getAttribute('aria-label')).toBe('Ampliar foto: Frente');
      expect(img.getAttribute('src')).toBe(ALL_PHOTOS[0].signedUrl);
      expect(img.className).toContain('object-cover');
      expect(first.className).toContain('hover:border-primary-500');
      const strip = first.querySelector('span')!;
      expect(strip.className).toContain('bg-black/65');
      expect(strip.textContent?.trim()).toBe('Frente');
    });

    it('sem foto: camera e o nome do angulo, sem faixa, sem texto vermelho, sem botao', () => {
      const fixture = renderWith({ status: 'PENDING' }, ALL_PHOTOS.slice(0, 9));
      const empty = frames(fixture).filter((el) => el.getAttribute('data-frame') === 'empty');

      expect(empty.length).toBe(5);
      const first = empty[0];
      expect(first.tagName).toBe('DIV');
      expect(first.querySelector('svg')).not.toBeNull();
      expect(first.querySelector('img')).toBeNull();
      // Das 9 primeiras (ate o Motor), o primeiro quadro vazio e o Porta-malas.
      expect((first.textContent ?? '').trim()).toBe('Porta-malas');
      expect(first.innerHTML).not.toMatch(/text-(red|rose)-/);
      expect(first.innerHTML).not.toContain('bg-black');
      expect(first.className).toContain('bg-neutral-50');
    });

    it('resume o que falta: "9 de 14 … Faltam 5 fotos." e "Falta 1 foto." no singular', () => {
      const nine = renderWith({ status: 'PENDING' }, ALL_PHOTOS.slice(0, 9));
      expect(q(nine, '[data-photo-summary]')?.textContent?.trim()).toBe(
        '9 de 14 ângulos enviados. Faltam 5 fotos.',
      );

      configure();
      const thirteen = renderWith({ status: 'PENDING' }, ALL_PHOTOS.slice(0, 13));
      expect(q(thirteen, '[data-photo-summary]')?.textContent?.trim()).toBe(
        '13 de 14 ângulos enviados. Falta 1 foto.',
      );
    });

    it('ordem e do ROTEIRO, nao da resposta do servidor', () => {
      const fixture = renderWith({}, [...ALL_PHOTOS].reverse());
      const labels = frames(fixture).map((el) => (el.textContent ?? '').trim());

      expect(labels.slice(0, 3)).toEqual(['Frente', 'Traseira', 'Lateral esquerda']);
    });

    it('alias legado `*_PANEL` cai no quadro do pneu, sem criar um quadro extra', () => {
      const legacy = ALL_PHOTOS.map((p) =>
        p.angle === 'FRONT_LEFT_TIRE' ? { ...p, angle: 'FRONT_LEFT_PANEL' } : p,
      );
      const fixture = renderWith({}, legacy);

      expect(frames(fixture).length).toBe(14);
      expect(
        frames(fixture).filter((el) => el.getAttribute('data-frame') === 'empty').length,
      ).toBe(0);
    });

    it('a chave da lista NAO e a signedUrl: reassinar nao recria as imagens', () => {
      const fixture = render();
      const before = Array.from(host(fixture).querySelectorAll('img'));

      photos.mockReturnValue(
        of(ALL_PHOTOS.map((p, n) => ({ ...p, signedUrl: `${p.signedUrl}&r=${n}` }))),
      );
      // Forca uma releitura pelo mesmo caminho do retry.
      (fixture.componentInstance as unknown as { loadPhotos: () => void }).loadPhotos();
      fixture.detectChanges();
      const after = Array.from(host(fixture).querySelectorAll('img'));

      expect(after.length).toBe(before.length);
      expect(after[0]).toBe(before[0]);
      expect(after[0].getAttribute('src')).toContain('&r=0');
    });

    it('a imagem que falha recarrega a LISTA uma vez; na segunda explica, sem laco', () => {
      const fixture = render();
      expect(photos).toHaveBeenCalledTimes(1);

      host(fixture).querySelector('img')?.dispatchEvent(new Event('error'));
      fixture.detectChanges();
      expect(photos).toHaveBeenCalledTimes(2);

      host(fixture).querySelector('img')?.dispatchEvent(new Event('error'));
      fixture.detectChanges();
      expect(photos).toHaveBeenCalledTimes(2);
      expect(text(fixture)).toContain('Os links das fotos expiraram');
    });

    describe('foto sem URL assinada (a assinatura dela falhou)', () => {
      const withNullUrl = ALL_PHOTOS.map((p) =>
        p.angle === 'DASHBOARD' ? { ...p, signedUrl: null } : p,
      );

      it('o quadro existe como placeholder e o aviso nomeia o angulo e diz que esta salva', () => {
        const fixture = renderWith({}, withNullUrl);

        expect(frames(fixture).length).toBe(14);
        expect(
          frames(fixture).filter((el) => el.getAttribute('data-frame') === 'empty').length,
        ).toBe(1);
        const warning = text(fixture);
        expect(warning).toContain('Não foi possível carregar a foto de: Painel');
        expect(warning).toContain('está salva');
      });

      it('oferece tentar de novo, e o retry busca as fotos outra vez', () => {
        const fixture = renderWith({}, withNullUrl);
        expect(photos).toHaveBeenCalledTimes(1);

        photos.mockReturnValue(of(ALL_PHOTOS));
        q<HTMLButtonElement>(fixture, '[data-retry-photos]')?.click();
        fixture.detectChanges();

        expect(photos).toHaveBeenCalledTimes(2);
        expect(q(fixture, '[data-retry-photos]')).toBeNull();
        expect(approveBtn(fixture)?.disabled).toBe(false);
      });

      it('NAO libera aprovar — ver 13 de 14 nao e ver — mas RECUSAR segue', () => {
        const fixture = renderWith({}, withNullUrl);

        expect(approveBtn(fixture)?.disabled).toBe(true);
        expect(q(fixture, '[data-start-reject]')?.hasAttribute('disabled')).toBe(false);
      });
    });

    it('falha ao buscar as fotos: banner, tentar de novo e aprovar travado', () => {
      photos.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );
      const fixture = render();

      expect(text(fixture)).toContain('Sem vê-las não dá para decidir');
      expect(q(fixture, '[data-retry-photos]')).not.toBeNull();
      expect(approveBtn(fixture)?.disabled).toBe(true);
      expect(frames(fixture).length).toBe(0);
    });
  });

  // ================================================================ visualizador

  describe('visualizador de fotos', () => {
    const dialog = (f: ComponentFixture<InspectionReview>) =>
      host(f).querySelectorAll<HTMLElement>('app-members-sheet [role="dialog"]');

    function open(f: ComponentFixture<InspectionReview>, label: string): void {
      host(f)
        .querySelector<HTMLButtonElement>(`[aria-label="Ampliar foto: ${label}"]`)
        ?.click();
      f.detectChanges();
      f.detectChanges();
    }

    const counter = (f: ComponentFixture<InspectionReview>) =>
      q(f, '[data-viewer-counter]')?.textContent?.trim();
    const title = (f: ComponentFixture<InspectionReview>) =>
      host(f).querySelector('app-members-sheet h2')?.textContent?.trim();

    it('abre com o angulo no titulo, "N de 14" e a data em que a foto foi tirada', () => {
      const fixture = render();
      expect(dialog(fixture).length).toBe(0);

      open(fixture, 'Traseira');

      expect(dialog(fixture).length).toBe(1);
      expect(title(fixture)).toBe('Traseira');
      expect(counter(fixture)).toBe('2 de 14');
      expect(q(fixture, '[data-viewer-image] img')?.getAttribute('src')).toBe(ALL_PHOTOS[1].signedUrl);
      expect(host(fixture).querySelector('app-members-sheet')?.textContent).toContain(
        'Tirada em 09/10/2026 08:40.',
      );
    });

    it('Proxima e Anterior PULAM os angulos sem foto, e dao a volta', () => {
      // Sem Traseira (indice 1) e sem Banco traseiro (13): da Frente vai a Lateral esquerda.
      const partial = ALL_PHOTOS.filter((p) => p.angle !== 'BACK' && p.angle !== 'REAR_SEAT');
      const fixture = renderWith({ status: 'PENDING' }, partial);

      open(fixture, 'Frente');
      expect(counter(fixture)).toBe('1 de 14');

      q<HTMLButtonElement>(fixture, '[data-viewer-next]')?.click();
      fixture.detectChanges();
      expect(title(fixture)).toBe('Lateral esquerda');
      expect(counter(fixture)).toBe('3 de 14');

      q<HTMLButtonElement>(fixture, '[data-viewer-prev]')?.click();
      q<HTMLButtonElement>(fixture, '[data-viewer-prev]')?.click();
      fixture.detectChanges();
      // De Frente, Anterior volta ao ultimo angulo COM foto (Banco dianteiro), nao ao 14o vazio.
      expect(title(fixture)).toBe('Banco dianteiro');
      expect(counter(fixture)).toBe('13 de 14');
    });

    it('fecha no X, no fundo e no Esc', () => {
      const fixture = render();

      open(fixture, 'Frente');
      host(fixture).querySelector<HTMLButtonElement>('app-members-sheet [aria-label="Fechar"]')?.click();
      fixture.detectChanges();
      expect(dialog(fixture).length).toBe(0);

      open(fixture, 'Frente');
      host(fixture)
        .querySelector<HTMLElement>('app-members-sheet [aria-hidden="true"]')
        ?.click();
      fixture.detectChanges();
      expect(dialog(fixture).length).toBe(0);

      open(fixture, 'Frente');
      dialog(fixture)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(dialog(fixture).length).toBe(0);
    });

    it('o X tem 44x44', () => {
      const fixture = render();
      open(fixture, 'Frente');
      const close = host(fixture).querySelector<HTMLElement>(
        'app-members-sheet [aria-label="Fechar"]',
      )!;

      expect(close.className).toContain('min-h-[44px]');
      expect(close.className).toContain('min-w-[44px]');
    });

    it('com uma foto so, nao ha para onde navegar', () => {
      const fixture = renderWith({ status: 'PENDING' }, ALL_PHOTOS.slice(0, 1));
      open(fixture, 'Frente');

      expect(q<HTMLButtonElement>(fixture, '[data-viewer-next]')?.disabled).toBe(true);
      expect(q<HTMLButtonElement>(fixture, '[data-viewer-prev]')?.disabled).toBe(true);
    });
  });

  // ============================================================== sua decisao

  describe('cartao "Sua decisao"', () => {
    it('aparece para dono e gerente quando a vistoria aguarda decisao', () => {
      for (const r of ['OWNER', 'MANAGER']) {
        role = r;
        configure();
        const fixture = render();

        expect(q(fixture, '[data-decision]'), r).not.toBeNull();
        expect(text(fixture), r).toContain('Sua decisão');
        expect(text(fixture), r).toContain(
          'Aprove se as 14 fotos e o hodômetro estão corretos. Se recusar, o motorista é avisado e refaz a vistoria inteira.',
        );
      }
    });

    it('so existe em SUBMITTED', () => {
      for (const status of ['PENDING', 'APPROVED', 'REJECTED'] as const) {
        configure();
        const fixture = renderWith({ status });
        expect(q(fixture, '[data-decision]'), status).toBeNull();
        expect(approveBtn(fixture), status).toBeNull();
      }
    });

    it('MOTORISTA nao recebe aprovar nem recusar — mas ve as fotos', () => {
      role = 'DRIVER';
      configure();
      const fixture = render();

      expect(q(fixture, '[data-decision]')).toBeNull();
      expect(approveBtn(fixture)).toBeNull();
      expect(q(fixture, '[data-start-reject]')).toBeNull();
      expect(frames(fixture).length).toBe(14);
    });

    it('o motorista na vistoria recusada tem o atalho para ler o motivo e refazer', () => {
      role = 'DRIVER';
      configure();
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: 'Refaça.' });

      expect(q<HTMLAnchorElement>(fixture, '[data-redo]')?.getAttribute('href')).toBe(
        '/vistorias/insp-1/captura',
      );
    });

    it('o dono na vistoria recusada nao ve o atalho de refazer', () => {
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: 'Refaça.' });

      expect(q(fixture, '[data-redo]')).toBeNull();
    });

    it('o motorista na vistoria em andamento pode continuar a captura', () => {
      role = 'DRIVER';
      configure();
      const fixture = renderWith({ status: 'PENDING' }, ALL_PHOTOS.slice(0, 5));

      expect(q<HTMLAnchorElement>(fixture, '[data-continue]')?.getAttribute('href')).toBe(
        '/vistorias/insp-1/captura',
      );
    });

    describe('Aprovar so com 14 fotos e hodometro', () => {
      const NOTE =
        'Aprovar fica disponível quando as 14 fotos e o hodômetro estiverem enviados.';

      it('completo: habilitado, laranja, sem a nota', () => {
        const fixture = render();
        const approveButton = approveBtn(fixture)!;

        expect(approveButton.disabled).toBe(false);
        expect(approveButton.textContent?.trim()).toBe('Aprovar vistoria');
        expect(approveButton.className).toContain('bg-primary-500');
        expect(q(fixture, '[data-approve-note]')).toBeNull();
      });

      it('falta uma foto: desabilitado, com a nota', () => {
        const fixture = renderWith({}, ALL_PHOTOS.slice(0, 13));
        const approveButton = approveBtn(fixture)!;

        expect(approveButton.disabled).toBe(true);
        expect(approveButton.className).toContain('disabled:opacity-50');
        expect(approveButton.className).toContain('disabled:cursor-not-allowed');
        expect(q(fixture, '[data-approve-note]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
          NOTE,
        );
        expect(approveButton.getAttribute('aria-describedby')).toBe('approve-note');
      });

      it('falta o hodometro: desabilitado, com a nota', () => {
        const fixture = renderWith({ odometerKm: null });

        expect(approveBtn(fixture)?.disabled).toBe(true);
        expect(q(fixture, '[data-approve-note]')).not.toBeNull();
      });

      it('hodometro ausente no payload (servidor antigo) tambem trava', () => {
        const fixture = renderWith({ odometerKm: undefined });

        expect(approveBtn(fixture)?.disabled).toBe(true);
      });

      it('clicar no desabilitado nao chama o servico', () => {
        const fixture = renderWith({ odometerKm: null });
        (fixture.componentInstance as unknown as { approve: () => void }).approve();

        expect(approve).not.toHaveBeenCalled();
      });

      it('no celular o primario fica ACIMA (flex-col-reverse)', () => {
        const fixture = render();
        const row = approveBtn(fixture)!.parentElement!;

        expect(row.className).toContain('flex-col-reverse');
        expect(row.className).toContain('sm:flex-row');
      });
    });

    describe('aprovar', () => {
      it('chama a API, avisa com a placa entre aspas, e relê a vistoria', () => {
        const success = vi.spyOn(notifications, 'success');
        getOne
          .mockReturnValueOnce(of(DETAIL))
          .mockReturnValue(of({ ...DETAIL, status: 'APPROVED' }));
        const fixture = render();

        approveBtn(fixture)?.click();
        fixture.detectChanges();

        expect(approve).toHaveBeenCalledWith('insp-1');
        expect(success).toHaveBeenCalledWith('Vistoria de «SJH2B17» aprovada.');
        expect(getOne).toHaveBeenCalledTimes(2);
        expect(q(fixture, '[data-decision]')).toBeNull();
        expect(q(fixture, '[data-status-chip]')?.textContent?.trim()).toBe('Aprovada');
      });

      it('falhar NAO e aprovar: mostra a mensagem do servidor, sem toast de sucesso', () => {
        const success = vi.spyOn(notifications, 'success');
        approve.mockReturnValue(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: {
                  message: 'Aprovar exige o hodômetro informado pelo motorista.',
                  code: 'INSPECTION_NO_ODOMETER',
                },
              }),
          ),
        );
        const fixture = render();

        approveBtn(fixture)?.click();
        fixture.detectChanges();

        expect(text(fixture)).toContain('Aprovar exige o hodômetro informado pelo motorista.');
        expect(success).not.toHaveBeenCalled();
        expect(q(fixture, '[data-decision]')).not.toBeNull();
        expect(getOne).toHaveBeenCalledTimes(1);
      });

      it('enquanto decide, nao decide duas vezes', () => {
        const pending = new Subject<InspectionReviewResult>();
        approve.mockReturnValue(pending);
        const fixture = render();

        approveBtn(fixture)?.click();
        fixture.detectChanges();
        expect(approveBtn(fixture)?.textContent).toContain('Registrando');
        approveBtn(fixture)?.click();

        expect(approve).toHaveBeenCalledTimes(1);
      });

      it('403 explica a regra em vez de erro cru', () => {
        approve.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
        const fixture = render();

        approveBtn(fixture)?.click();
        fixture.detectChanges();

        expect(text(fixture)).toContain('Só o dono ou o gerente');
      });
    });

    describe('recusar', () => {
      it('"Recusar" abre o motivo, com a ajuda e os dois botoes do desenho', () => {
        const fixture = render();

        button(fixture, 'Recusar').click();
        fixture.detectChanges();

        const body = text(fixture);
        expect(body).toContain('Motivo da recusa');
        expect(body).toContain('É o que o motorista vai ler para saber o que refazer.');
        expect(q(fixture, '[data-reject-reason]')?.getAttribute('maxlength')).toBe('1000');
        expect(() => button(fixture, 'Voltar')).not.toThrow();
        expect(() => button(fixture, 'Recusar e pedir nova vistoria')).not.toThrow();
        expect(approveBtn(fixture)).toBeNull();
      });

      it('o campo e 16px no celular', () => {
        const fixture = render();
        button(fixture, 'Recusar').click();
        fixture.detectChanges();

        expect(q(fixture, '[data-reject-reason]')?.className).toContain('text-base');
      });

      it('"Voltar" fecha o motivo e esquece o que foi digitado', () => {
        const fixture = render();
        button(fixture, 'Recusar').click();
        fixture.detectChanges();
        typeReason(fixture, 'Algo');

        button(fixture, 'Voltar').click();
        fixture.detectChanges();
        expect(q(fixture, '[data-reject-reason]')).toBeNull();

        button(fixture, 'Recusar').click();
        fixture.detectChanges();
        expect(q<HTMLTextAreaElement>(fixture, '[data-reject-reason]')?.value).toBe('');
      });

      it('motivo vazio: mostra "Escreva o motivo da recusa." e NAO abre a confirmacao', () => {
        const fixture = render();
        button(fixture, 'Recusar').click();
        fixture.detectChanges();

        button(fixture, 'Recusar e pedir nova vistoria').click();
        fixture.detectChanges();

        expect(text(fixture)).toContain('Escreva o motivo da recusa.');
        expect(q(fixture, '[role="alert"]')?.textContent).toContain('Escreva o motivo da recusa.');
        expect(confirmDialog(fixture)).toBeNull();
        expect(reject).not.toHaveBeenCalled();
      });

      it('so espacos tambem nao vale', () => {
        const fixture = render();
        button(fixture, 'Recusar').click();
        fixture.detectChanges();
        typeReason(fixture, '    ');

        button(fixture, 'Recusar e pedir nova vistoria').click();
        fixture.detectChanges();

        expect(confirmDialog(fixture)).toBeNull();
        expect(reject).not.toHaveBeenCalled();
      });

      it('com motivo, abre a confirmacao com a frase do desenho — e ainda nao recusa', () => {
        const fixture = render();

        askToReject(fixture);

        const dialog = confirmDialog(fixture);
        expect(dialog).not.toBeNull();
        expect(dialog?.textContent).toContain('Recusar vistoria');
        expect((dialog?.textContent ?? '').replace(/\s+/g, ' ')).toContain(
          'Carlos será avisado e precisa refazer a vistoria do veículo «SJH2B17» do zero.',
        );
        expect(reject).not.toHaveBeenCalled();
      });

      it('"Voltar" na confirmacao nao recusa e mantem o motivo', async () => {
        const fixture = render();
        askToReject(fixture, 'Painel desfocado.');

        const cancel = Array.from(
          host(fixture).querySelectorAll<HTMLButtonElement>('app-confirm-dialog button'),
        ).find((b) => b.textContent?.trim() === 'Voltar')!;
        cancel.click();
        fixture.detectChanges();
        // A remocao do no termina depois do `:leave`, mesmo com animacoes noop.
        await fixture.whenStable();
        fixture.detectChanges();

        expect(confirmDialog(fixture)).toBeNull();
        expect(reject).not.toHaveBeenCalled();
        expect(q<HTMLTextAreaElement>(fixture, '[data-reject-reason]')?.value).toBe(
          'Painel desfocado.',
        );
      });

      it('confirmar recusa com o motivo aparado, avisa com «guillemets» e relê', () => {
        const success = vi.spyOn(notifications, 'success');
        getOne
          .mockReturnValueOnce(of(DETAIL))
          .mockReturnValue(
            of({ ...DETAIL, status: 'REJECTED', rejectionReason: 'Painel desfocado.' }),
          );
        const fixture = render();
        askToReject(fixture, '  Painel desfocado.  ');

        const confirm = Array.from(
          host(fixture).querySelectorAll<HTMLButtonElement>('app-confirm-dialog button'),
        ).find((b) => b.textContent?.trim() === 'Recusar vistoria')!;
        confirm.click();
        fixture.detectChanges();

        expect(reject).toHaveBeenCalledWith('insp-1', 'Painel desfocado.');
        expect(success).toHaveBeenCalledWith(
          'Vistoria de «SJH2B17» recusada. Carlos foi avisado.',
        );
        expect(getOne).toHaveBeenCalledTimes(2);
        expect(q(fixture, '[data-decision]')).toBeNull();
        expect(q(fixture, '[data-rejected-strip]')).not.toBeNull();
      });

      it('falhar NAO e recusar: preserva o motivo digitado e nao mostra toast', () => {
        const success = vi.spyOn(notifications, 'success');
        reject.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
        const fixture = render();
        askToReject(fixture, 'Painel desfocado.');

        Array.from(host(fixture).querySelectorAll<HTMLButtonElement>('app-confirm-dialog button'))
          .find((b) => b.textContent?.trim() === 'Recusar vistoria')
          ?.click();
        fixture.detectChanges();

        expect(success).not.toHaveBeenCalled();
        expect(q<HTMLTextAreaElement>(fixture, '[data-reject-reason]')?.value).toBe(
          'Painel desfocado.',
        );
        expect(text(fixture)).toContain('Nada foi alterado');
        expect(q(fixture, '[data-decision]')).not.toBeNull();
      });
    });
  });

  // ==================================================================== o PDF

  describe('card do laudo em PDF', () => {
    it('so existe na vistoria APROVADA', () => {
      for (const status of ['PENDING', 'SUBMITTED', 'REJECTED'] as const) {
        configure();
        expect(q(renderWith({ status }), '[data-pdf-card]'), status).toBeNull();
      }
      configure();
      expect(q(renderWith({ status: 'APPROVED' }), '[data-pdf-card]')).not.toBeNull();
    });

    it('nomeia o arquivo pelo tipo e pela placa e diz de onde vem o laudo', () => {
      const fixture = renderWith({ status: 'APPROVED' });
      const card = q(fixture, '[data-pdf-card]')!;

      expect(q(fixture, '[data-pdf-name]')?.textContent?.trim()).toBe(
        'vistoria-retirada-SJH2B17.pdf',
      );
      expect(card.textContent).toContain('Laudo gerado a partir das 14 fotos');
      expect(card.querySelector('.bg-rose-50')).not.toBeNull();
    });

    it('devolucao: o nome leva "devolução"', () => {
      const fixture = renderWith({ status: 'APPROVED', kind: 'CHECKIN' });

      expect(q(fixture, '[data-pdf-name]')?.textContent?.trim()).toBe(
        'vistoria-devolução-SJH2B17.pdf',
      );
    });

    it('"Ver PDF" e o primario e abre o laudo no visualizador do app, sem aba nova', () => {
      const windowOpen = vi.spyOn(window, 'open');
      const fixture = renderWith({ status: 'APPROVED' });
      const view = q<HTMLButtonElement>(fixture, '[data-view-pdf]')!;

      expect(view.textContent?.trim()).toBe('Ver PDF');
      expect(view.className).toContain('bg-primary-500');

      view.click();
      fixture.detectChanges();

      expect(windowOpen).not.toHaveBeenCalled();
      expect(previewOpen).toHaveBeenCalledTimes(1);
      const [request] = previewOpen.mock.calls[0] as [
        { source: () => Observable<{ url: string }>; fileName: string },
      ];
      expect(request.fileName).toBe('vistoria-retirada-SJH2B17.pdf');
      // A URL assinada só é pedida quando o visualizador carrega.
      expect(reportUrl).not.toHaveBeenCalled();
      let url = '';
      request.source().subscribe((res) => (url = res.url));
      expect(reportUrl).toHaveBeenCalledWith('insp-1');
      expect(url).toBe('https://storage.example/laudo.pdf?sig=1');
      windowOpen.mockRestore();
    });
  });

  // ============================================================= mobile-first

  describe('mobile-first', () => {
    it('nenhum controle da tela tem alvo abaixo de 44px', () => {
      const fixture = render();
      button(fixture, 'Recusar').click();
      fixture.detectChanges();

      const small = Array.from(host(fixture).querySelectorAll<HTMLElement>('button, a[href]'))
        .filter((el) => !el.closest('app-members-sheet'))
        .filter((el) => !/min-h-\[44px\]|min-h-11|min-h-12|aspect-square/.test(el.className))
        .map((el) => `${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}"`);

      expect(small).toEqual([]);
    });

    it('os botoes de acao ocupam a largura toda no celular', () => {
      const fixture = render();

      expect(approveBtn(fixture)?.className).toContain('w-full');
      expect(approveBtn(fixture)?.className).toContain('sm:w-auto');
    });
  });
});
