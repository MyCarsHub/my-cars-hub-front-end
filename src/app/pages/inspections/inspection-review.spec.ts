import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectionReview } from './inspection-review';
import { ApiErrorService } from '../../services/api-error.service';
import {
  DOCUMENT_PREVIEW_VIEWER,
  DocumentPreviewService,
} from '../../components/document-preview/document-preview.service';
import { DocumentPreviewViewer } from '../../components/document-preview/document-preview-viewer';
import { DocxPreviewEngine } from '../../components/document-preview/docx-preview-engine';
import { PdfPreviewEngine } from '../../components/document-preview/pdf-preview-engine';
import { LoggerService } from '../../services/logger.service';
import type {
  DocumentPreviewGallery,
  DocumentPreviewItem,
} from '../../components/document-preview/document-preview.types';
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
  let list: ReturnType<typeof vi.fn>;
  let peek: ReturnType<typeof vi.fn>;
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
    list = vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 }));
    peek = vi.fn().mockReturnValue(of({ content: [{ id: 'insp-1' }], page: 0, size: 1, total: 1 }));
    params = new BehaviorSubject(convertToParamMap({ id: 'insp-1' }));

    TestBed.configureTestingModule({
      imports: [InspectionReview],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ApiErrorService,
        {
          provide: InspectionsService,
          useValue: { getOne, photos, approve, reject, reportUrl, list, peek },
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
      expect(q(fixture, '[data-odometer-value]')?.className).toContain('text-fg-subtle');
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
      expect(first.className).toContain('bg-surface-muted');
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

  describe('visualizador de fotos (DocumentPreviewService)', () => {
    function open(f: ComponentFixture<InspectionReview>, label: string): void {
      host(f)
        .querySelector<HTMLButtonElement>(`[aria-label="Ampliar foto: ${label}"]`)
        ?.click();
      f.detectChanges();
    }

    /** A galeria que o servico recebeu na ultima abertura. */
    const gallery = () => previewOpen.mock.calls.at(-1)?.[0] as DocumentPreviewGallery;
    const fetchUrl = (item: DocumentPreviewItem) =>
      firstValueFrom((item.source as () => Observable<string>)());

    it('clicar na miniatura abre a galeria com as 14 fotos, no indice do angulo clicado', () => {
      const fixture = render();
      expect(previewOpen).not.toHaveBeenCalled();

      open(fixture, 'Traseira');

      expect(previewOpen).toHaveBeenCalledTimes(1);
      expect(gallery().items.length).toBe(14);
      expect(gallery().startIndex).toBe(1);
      expect(gallery().items.map((i) => i.title)).toEqual(
        RENTAL_PHOTO_ANGLES.map((a) => a.label),
      );
    });

    it('mantem o titulo e a legenda do lightbox antigo: angulo no titulo, "Tirada em" embaixo', () => {
      const fixture = render();

      open(fixture, 'Traseira');

      const item = gallery().items[1];
      expect(item.title).toBe('Traseira');
      expect(item.caption).toBe('Tirada em 09/10/2026 08:40');
      expect(item.errorMessage).toContain('Ela está salva');
      // Sem titulo de galeria: o modal mostra o titulo de CADA foto.
      expect(gallery().title).toBeUndefined();
    });

    it('o nome do arquivo baixado leva o tipo, a placa e o angulo', () => {
      const fixture = render();

      open(fixture, 'Frente');

      expect(gallery().items[0].fileName).toBe('vistoria-retirada-SJH2B17-front');
    });

    it('angulos sem foto ficam FORA da galeria e o indice conta so as fotos', () => {
      // Sem Traseira (posicao 1) e sem Banco traseiro (13): sobram 12 fotos.
      const partial = ALL_PHOTOS.filter((p) => p.angle !== 'BACK' && p.angle !== 'REAR_SEAT');
      const fixture = renderWith({ status: 'PENDING' }, partial);

      open(fixture, 'Lateral esquerda');

      expect(gallery().items.length).toBe(12);
      expect(gallery().items.map((i) => i.title)).not.toContain('Traseira');
      expect(gallery().items.map((i) => i.title)).not.toContain('Banco traseiro');
      // Frente e 0; Lateral esquerda e a SEGUNDA foto, nao a terceira posicao do roteiro.
      expect(gallery().startIndex).toBe(1);
      expect(gallery().items[1].title).toBe('Lateral esquerda');
    });

    it('com uma foto so, a galeria tem um item', () => {
      const fixture = renderWith({ status: 'PENDING' }, ALL_PHOTOS.slice(0, 1));

      open(fixture, 'Frente');

      expect(gallery().items.length).toBe(1);
      expect(gallery().startIndex).toBe(0);
    });

    it('a ordem e a do ROTEIRO, nao a da resposta do servidor', () => {
      const fixture = renderWith({}, [...ALL_PHOTOS].reverse());

      open(fixture, 'Frente');

      expect(gallery().startIndex).toBe(0);
      expect(gallery().items[0].title).toBe('Frente');
    });

    it('nao ha mais o lightbox antigo: nenhuma folha e aberta pela tela', () => {
      const fixture = render();

      open(fixture, 'Frente');

      expect(host(fixture).querySelector('app-members-sheet')).toBeNull();
      expect(host(fixture).querySelector('[role="dialog"]')).toBeNull();
      expect(host(fixture).querySelector('[data-viewer-next]')).toBeNull();
    });

    it('o quadro sem foto nao e botao e nao abre nada', () => {
      const fixture = renderWith({}, ALL_PHOTOS.slice(1));

      const empty = frames(fixture).find((el) => el.getAttribute('data-frame') === 'empty');
      empty?.click();
      fixture.detectChanges();

      expect(empty?.tagName).toBe('DIV');
      expect(previewOpen).not.toHaveBeenCalled();
    });

    it('o motorista (so leitura) tambem amplia a foto da propria vistoria', () => {
      role = 'DRIVER';
      const fixture = render();

      host(fixture).querySelector<HTMLButtonElement>('[aria-label="Ver foto: Frente"]')?.click();
      fixture.detectChanges();

      expect(previewOpen).toHaveBeenCalledTimes(1);
      expect(gallery().items.length).toBe(14);
    });

    describe('a origem dos bytes (a URL assinada expira)', () => {
      it('a primeira tentativa usa a URL que a tela ja tem, sem pedir a lista de novo', async () => {
        const fixture = render();
        open(fixture, 'Traseira');
        expect(photos).toHaveBeenCalledTimes(1);

        const url = await fetchUrl(gallery().items[1]);

        expect(url).toBe(ALL_PHOTOS[1].signedUrl);
        expect(photos).toHaveBeenCalledTimes(1);
      });

      it('"Tentar de novo" pede a lista outra vez e usa a URL NOVA daquele angulo', async () => {
        const fixture = render();
        open(fixture, 'Traseira');
        const item = gallery().items[1];
        await fetchUrl(item);

        photos.mockReturnValue(
          of(ALL_PHOTOS.map((p, n) => photoFor(p.angle, n, `https://cdn.example/novo-${n}.jpg`))),
        );
        const retry = await fetchUrl(item);

        expect(photos).toHaveBeenCalledTimes(2);
        expect(photos).toHaveBeenLastCalledWith('insp-1');
        expect(retry).toBe('https://cdn.example/novo-1.jpg');
        // A lista nova vai para a tela: a proxima abertura nao parte da URL vencida.
        fixture.detectChanges();
        expect(
          host(fixture).querySelector('[aria-label="Ampliar foto: Traseira"] img')?.getAttribute('src'),
        ).toBe('https://cdn.example/novo-1.jpg');
      });

      it('a foto cuja assinatura falhou entra na galeria e busca a URL ao abrir', async () => {
        const withNullUrl = ALL_PHOTOS.map((p) =>
          p.angle === 'DASHBOARD' ? { ...p, signedUrl: null } : p,
        );
        const fixture = renderWith({}, withNullUrl);
        // O quadro dela e placeholder (nao clica); outra foto abre a galeria.
        open(fixture, 'Frente');
        const dashboard = gallery().items.find((i) => i.title === 'Painel');
        expect(dashboard).toBeDefined();

        photos.mockReturnValue(of(ALL_PHOTOS));
        const url = await fetchUrl(dashboard!);

        expect(photos).toHaveBeenCalledTimes(2);
        expect(url).toBe(ALL_PHOTOS.find((p) => p.angle === 'DASHBOARD')?.signedUrl);
      });

      it('se a lista nova tambem vem sem URL, falha (o modal mostra a mensagem e o retry)', async () => {
        const fixture = render();
        open(fixture, 'Traseira');
        const item = gallery().items[1];
        await fetchUrl(item);

        photos.mockReturnValue(of(ALL_PHOTOS.map((p) => ({ ...p, signedUrl: null }))));

        await expect(fetchUrl(item)).rejects.toThrow('photo-url-unavailable');
      });

      it('se a lista nova falha no servidor, o erro chega ao modal', async () => {
        const fixture = render();
        open(fixture, 'Traseira');
        const item = gallery().items[1];
        await fetchUrl(item);

        photos.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

        await expect(fetchUrl(item)).rejects.toBeInstanceOf(HttpErrorResponse);
      });
    });
  });

  // ===================================== visualizador de verdade (integracao)

  /**
   * O sujeito aqui e a COSTURA: tela + `DocumentPreviewService` + `DocumentPreviewViewer`
   * reais, so com o `import()` dinamico trocado por um carregador sincrono e as duas
   * bibliotecas (pdf.js, docx-preview) por stubs. O `fetch` do storage e o unico dublê.
   */
  describe('visualizador real: URL assinada vencida', () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const FRESH = (n: number) => `https://cdn.example/novo-${n}.jpg`;
    let service: DocumentPreviewService;
    let fetchSpy: ReturnType<typeof vi.fn>;

    async function settle(f: ComponentFixture<InspectionReview>): Promise<void> {
      for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => setTimeout(resolve));
        f.detectChanges();
        TestBed.tick();
      }
    }
    const modal = () => document.body.querySelector('app-document-preview-viewer');

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [InspectionReview],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          ApiErrorService,
          { provide: InspectionsService, useValue: { getOne, photos, approve, reject, reportUrl } },
          { provide: SessionService, useValue: { getCompanyRoleFromToken: () => role } },
          { provide: ActivatedRoute, useValue: { paramMap: params } },
          // Reais: DocumentPreviewService e DocumentPreviewViewer.
          { provide: DOCUMENT_PREVIEW_VIEWER, useValue: () => Promise.resolve(DocumentPreviewViewer) },
          { provide: PdfPreviewEngine, useValue: { open: vi.fn() } },
          { provide: DocxPreviewEngine, useValue: { toSafeHtml: vi.fn() } },
          { provide: LoggerService, useValue: { error: vi.fn(), warn: vi.fn() } },
        ],
      });
      service = TestBed.inject(DocumentPreviewService);

      let n = 0;
      Object.assign(URL, {
        createObjectURL: vi.fn(() => `blob:test/${++n}`),
        revokeObjectURL: vi.fn(),
      });
      // A foto da Traseira (a clicada) venceu: 403 do storage. As URLs NOVAS respondem.
      fetchSpy = vi.fn((url: string) =>
        Promise.resolve(
          url === ALL_PHOTOS[1].signedUrl
            ? new Response('', { status: 403 })
            : new Response(PNG, { status: 200 }),
        ),
      );
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy as never);
    });

    afterEach(() => {
      service.close();
      vi.restoreAllMocks();
    });

    it('403 na primeira URL mostra "Tentar de novo"; o clique busca a URL NOVA da lista', async () => {
      const fixture = render();
      host(fixture)
        .querySelector<HTMLButtonElement>('[aria-label="Ampliar foto: Traseira"]')
        ?.click();
      await settle(fixture);

      // O modal REAL abriu na foto clicada, falhou com 403 e oferece o retry.
      expect(modal()).not.toBeNull();
      expect(modal()?.querySelector('[data-preview-state="error"]')?.textContent).toContain(
        'O link do arquivo expirou',
      );
      expect(fetchSpy).toHaveBeenCalledWith(ALL_PHOTOS[1].signedUrl, expect.anything());
      expect(photos).toHaveBeenCalledTimes(1);

      photos.mockReturnValue(
        of(ALL_PHOTOS.map((p, n) => photoFor(p.angle, n, FRESH(n)))),
      );
      modal()?.querySelector<HTMLButtonElement>('[data-preview-retry]')?.click();
      await settle(fixture);

      expect(photos).toHaveBeenCalledTimes(2);
      expect(fetchSpy).toHaveBeenCalledWith(FRESH(1), expect.anything());
      expect(modal()?.querySelector('[data-preview-state="error"]')).toBeNull();
      // A lista nova tambem foi para a tela: a proxima abertura nao parte da URL vencida.
      const thumb = host(fixture).querySelector('[aria-label="Ampliar foto: Traseira"] img');
      expect(thumb?.getAttribute('src')).toBe(FRESH(1));
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

      expect(q(fixture, 'app-driver-inspection-detail')).not.toBeNull();
      expect(q(fixture, '[data-decision]')).toBeNull();
      expect(approveBtn(fixture)).toBeNull();
      expect(q(fixture, '[data-start-reject]')).toBeNull();
      expect(host(fixture).querySelectorAll('[data-driver-photo]').length).toBe(14);
    });

    it('o motorista ve o resumo do prototipo: veiculo, cor e ano, tipo e hodometro', () => {
      role = 'DRIVER';
      configure();
      const fixture = renderWith({ odometerKm: 42318 });
      const values = Array.from(host(fixture).querySelectorAll('[data-driver-field]')).map((el) =>
        (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );

      expect(values).toHaveLength(4);
      expect(values[3]).toBe('42.318 km');
    });

    it('o motorista na aprovada abre o laudo no visualizador do app', () => {
      role = 'DRIVER';
      configure();
      const fixture = renderWith({ status: 'APPROVED' });

      q<HTMLButtonElement>(fixture, '[data-driver-open-report]')!.click();

      expect(previewOpen).toHaveBeenCalledTimes(1);
      expect(previewOpen.mock.calls[0][0]).toEqual(
        expect.objectContaining({ title: 'Laudo da vistoria' }),
      );
    });

    it('o motorista na vistoria recusada tem o atalho para ler o motivo e refazer', () => {
      role = 'DRIVER';
      configure();
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: 'Refaça.' });

      expect(q(fixture, '[data-driver-rejected]')?.textContent).toContain('Motivo: Refaça.');
      expect(peek).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleId: DETAIL.vehicleId, page: 0, size: 1, sort: 'date,desc' }),
      );
      // `list` would overwrite the Vistorias page's state (items, loading, error).
      expect(list).not.toHaveBeenCalled();
      expect(q<HTMLAnchorElement>(fixture, '[data-driver-redo]')?.getAttribute('href')).toBe(
        '/vistorias/insp-1/captura',
      );
    });

    it('recusada ANTIGA (ja existe uma mais recente do carro) nao oferece refazer', () => {
      role = 'DRIVER';
      configure();
      peek.mockReturnValue(of({ content: [{ id: 'insp-9' }], page: 0, size: 1, total: 2 }));
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: 'Refaça.' });

      expect(q(fixture, '[data-driver-redo]')).toBeNull();
      expect(q(fixture, '[data-driver-redo-elsewhere]')).not.toBeNull();
    });

    it('checagem que falhou nao afirma nada: aponta para Vistorias, sem botao', () => {
      role = 'DRIVER';
      configure();
      peek.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: 'Refaça.' });

      expect(q(fixture, '[data-driver-redo]')).toBeNull();
      expect(q(fixture, '[data-driver-redo-elsewhere]')).toBeNull();
      expect(
        q<HTMLAnchorElement>(fixture, '[data-driver-redo-unknown] a')?.getAttribute('href'),
      ).toBe('/vistorias');
    });

    it('resposta atrasada da vistoria anterior nao decide o refazer da atual', () => {
      role = 'DRIVER';
      configure();
      const slow = new Subject<{ content: { id: string }[]; page: number; size: number; total: number }>();
      peek.mockReturnValue(slow);
      getOne.mockReturnValue(of({ ...DETAIL, status: 'REJECTED', rejectionReason: 'Refaça.' }));
      const fixture = render();

      // Same instance, another id (the route reuses it), whose own check has not answered.
      peek.mockReturnValue(new Subject());
      getOne.mockReturnValue(
        of({ ...DETAIL, id: 'insp-2', status: 'REJECTED', rejectionReason: 'Outra.' }),
      );
      params.next(convertToParamMap({ id: 'insp-2' }));
      fixture.detectChanges();

      // insp-1's answer arrives late and says "insp-1 is the latest".
      slow.next({ content: [{ id: 'insp-1' }], page: 0, size: 1, total: 1 });
      fixture.detectChanges();

      expect(q(fixture, '[data-driver-redo]')).toBeNull();
      expect(q(fixture, '[data-driver-redo-elsewhere]')).toBeNull();
    });

    it('OWNER e MANAGER nao fazem a checagem do motorista', () => {
      for (const actor of ['OWNER', 'MANAGER']) {
        role = actor;
        configure();
        renderWith({ status: 'REJECTED', rejectionReason: 'Refaça.' });

        expect(peek, actor).not.toHaveBeenCalled();
      }
    });

    it('o dono na vistoria recusada nao ve o atalho de refazer', () => {
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: 'Refaça.' });

      expect(q(fixture, '[data-redo]')).toBeNull();
    });

    it('o motorista na vistoria em andamento pode continuar a captura', () => {
      role = 'DRIVER';
      configure();
      const fixture = renderWith({ status: 'PENDING' }, ALL_PHOTOS.slice(0, 5));

      expect(q<HTMLAnchorElement>(fixture, '[data-driver-continue]')?.getAttribute('href')).toBe(
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
