import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MaintenanceForm } from './maintenance-form';
import { MaintenancesService } from '../../services/maintenances.service';
import { VehiclesService } from '../../services/vehicles.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';
import { flatErrorMessage, parseApiError } from '../../services/api-error';
import type { Maintenance, MaintenanceDocument } from '../../types/maintenance.types';

/**
 * Anexar documento no CADASTRO da manutenção (FEAT-0055).
 *
 * A RESTRIÇÃO QUE DEFINE O NÓ: no cadastro a manutenção ainda não tem id, e o
 * `storage_path` é `{entidade}/{id}/…` com FK para a linha do pai. Logo o
 * upload NÃO pode ser síncrono com o formulário — é salvar primeiro, subir
 * depois. Tudo aqui verifica as consequências disso:
 *
 *  - a manutenção SOBREVIVE à falha do anexo (ela já foi criada);
 *  - o reenvio manda SÓ o que faltou, nunca o que já subiu;
 *  - o reenvio faz PUT da mesma manutenção, nunca um segundo POST.
 *
 * O gesto passa pelo DOM: clique real no slot e `change` real no
 * `<input type="file">` — desde o FIX-0233 esse DOM é o do
 * `PendingDocumentsBlock` compartilhado.
 *
 * REGRA NOVA (FIX-0233, decisão estrita do usuário): UM arquivo por tipo.
 * Escolher de novo SUBSTITUI o pendente daquele tipo, então a fila tem no
 * máximo 2 itens (1 nota fiscal + 1 outro) — as provas de falha parcial e
 * reenvio abaixo usam DOIS TIPOS em vez de N notas fiscais, mas verificam
 * exatamente as mesmas invariantes.
 */
describe('MaintenanceForm — anexos no cadastro', () => {
  const CREATED: Maintenance = {
    id: 'mnt-novo',
    createdDate: '2026-08-29T00:00:00Z',
    modifyDate: null,
    companyId: 'co-1',
    vehicleId: 'veh-1',
    type: 'PREVENTIVE',
    description: 'Revisão dos 10.000 km',
    serviceDate: '2026-08-10',
    hodometerReading: null,
    costCents: 0,
    items: [],
    labourCostCents: 0,
    discountCents: 0,
    surchargeCents: 0,
    surchargeNote: null,
    provider: null,
    invoiceNumber: null,
    nextServiceDate: null,
    nextServiceHodometer: null,
    status: 'SCHEDULED',
    notes: null,
  };

  const BASE_VALUES = {
    vehicleId: 'veh-1',
    type: 'PREVENTIVE',
    description: 'Revisão dos 10.000 km',
    serviceDate: '2026-08-10',
    status: 'SCHEDULED',
  };

  function savedDoc(id: string): MaintenanceDocument {
    return {
      id,
      maintenanceId: CREATED.id,
      kind: 'NOTA_FISCAL',
      kindLabel: 'Nota fiscal',
      fileName: `${id}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      uploadedBy: 'user-1',
      createdDate: '2026-08-29T00:00:00Z',
    };
  }

  interface ExposedForm {
    form: {
      patchValue: (v: Record<string, unknown>) => void;
      controls: { vehicleId: { disabled: boolean } };
    };
    submit: () => void;
    saving: () => boolean;
    pendingDocs: () => ReadonlyArray<{ uid: string; file: File; kind: string }>;
    error: () => string | null;
  }

  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let uploadDocument: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<MaintenanceForm>;
  let component: ExposedForm;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * O cabeçalho do slot dentro do `PendingDocumentsBlock` compartilhado
   * (FIX-0233): `data-doc-slot` marca o CONTÊINER, e quem recebe o toque é o
   * botão dentro dele.
   */
  function slotButton(kind: string): HTMLButtonElement {
    const el = host().querySelector<HTMLButtonElement>(`[data-doc-slot="${kind}"] > button`);
    if (!el) throw new Error(`o slot ${kind} não está na tela`);
    return el;
  }

  /** As linhas de arquivo pendente, agora aninhadas sob o slot do seu tipo. */
  function pendingRows(): HTMLElement[] {
    return Array.from(host().querySelectorAll<HTMLElement>('[data-doc-slot] ul > li'));
  }

  function fileInput(): HTMLInputElement {
    const el = host().querySelector<HTMLInputElement>('input[type="file"]');
    if (!el) throw new Error('o seletor de arquivos não está na tela');
    return el;
  }

  function pdf(name: string, size = 1024, type = 'application/pdf'): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: size, configurable: true });
    return file;
  }

  /** Gesto completo: toca no slot do tipo e escolhe o arquivo. */
  function stage(kind: string, file: File): void {
    slotButton(kind).click();
    fixture.detectChanges();
    const input = fileInput();
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function configure(existing: Maintenance | null): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MaintenanceForm],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: (k: string) => (k === 'id' && existing ? existing.id : null) },
            },
          },
        },
        {
          provide: MaintenancesService,
          useValue: {
            getOne: vi.fn().mockReturnValue(existing ? of(existing) : of(CREATED)),
            create,
            update,
            uploadDocument,
            remove: vi.fn(),
          },
        },
        {
          provide: VehiclesService,
          useValue: {
            list: vi.fn().mockReturnValue(of({ content: [], page: 0, size: 20, total: 0 })),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
        },
        {
          provide: ApiErrorService,
          useValue: {
            claim: vi.fn(),
            handleForm: vi.fn(() => ({ formMessage: 'falhou' })),
            messageFor: vi.fn((e: unknown, fallback?: string) =>
              flatErrorMessage(parseApiError(e), fallback),
            ),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(MaintenanceForm);
    fixture.detectChanges();
    component = fixture.componentInstance as unknown as ExposedForm;
    component.form.patchValue(BASE_VALUES);
    fixture.detectChanges();
  }

  beforeEach(() => {
    create = vi.fn().mockReturnValue(of(CREATED));
    update = vi.fn().mockReturnValue(of(CREATED));
    uploadDocument = vi.fn(() => of(savedDoc('doc-1')));
  });

  it('sem arquivo escolhido, o cadastro segue sem chamar upload nenhum', () => {
    configure(null);

    component.submit();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledTimes(1);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('os arquivos escolhidos sobem, um a um, com o id da manutenção recém-criada', () => {
    configure(null);

    stage('NOTA_FISCAL', pdf('nota-peca.pdf'));
    stage('OTHER', pdf('foto.jpg', 2048, 'image/jpeg'));
    expect(pendingRows()).toHaveLength(2);

    component.submit();
    fixture.detectChanges();

    expect(create).toHaveBeenCalledTimes(1);
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    // O id vem da RESPOSTA do create — no cadastro ele não existia antes.
    expect(uploadDocument.mock.calls.map((c) => c[0])).toEqual(['mnt-novo', 'mnt-novo']);
    expect(uploadDocument.mock.calls.map((c) => c[1])).toEqual(['NOTA_FISCAL', 'OTHER']);
    expect(uploadDocument.mock.calls.map((c) => (c[2] as File).name)).toEqual([
      'nota-peca.pdf',
      'foto.jpg',
    ]);
    expect(component.pendingDocs()).toHaveLength(0);
  });

  // ------------------------------------------------- falha parcial e reenvio

  it('falha no meio: a manutenção SOBREVIVE e só os não enviados ficam na fila', () => {
    configure(null);
    uploadDocument
      .mockReturnValueOnce(of(savedDoc('doc-1')))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));

    stage('NOTA_FISCAL', pdf('a.pdf'));
    stage('OTHER', pdf('b.pdf'));

    component.submit();
    fixture.detectChanges();

    // A manutenção foi criada uma vez e NÃO foi desfeita.
    expect(create).toHaveBeenCalledTimes(1);
    // O primeiro subiu e SAIU da fila; o que falhou continua nela.
    expect(component.pendingDocs().map((d) => d.file.name)).toEqual(['b.pdf']);
    expect(pendingRows()).toHaveLength(1);
    // A mensagem diz PRIMEIRO que a manutenção foi salva.
    expect(component.error()).toContain('A manutenção foi salva.');
  });

  it('o bloco de anexos CONTINUA na tela depois da falha parcial, para o reenvio', () => {
    configure(null);
    uploadDocument.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    stage('NOTA_FISCAL', pdf('a.pdf'));
    component.submit();
    fixture.detectChanges();

    // `isEdit()` já é true aqui (editingId foi promovido). Se o bloco fosse
    // escondido por `isEdit()`, ele sumiria justo agora e o reenvio seria
    // impossível — é para isso que existe `startedAsEdit`.
    expect(host().querySelector('[data-doc-slot="NOTA_FISCAL"]')).not.toBeNull();
    expect(pendingRows()).toHaveLength(1);
  });

  it('reenvio manda SÓ o que faltou e faz PUT, nunca um segundo POST', () => {
    configure(null);
    uploadDocument
      .mockReturnValueOnce(of(savedDoc('doc-1')))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));

    stage('NOTA_FISCAL', pdf('a.pdf'));
    stage('OTHER', pdf('b.pdf'));
    component.submit();
    fixture.detectChanges();
    expect(component.pendingDocs().map((d) => d.file.name)).toEqual(['b.pdf']);

    uploadDocument.mockReset();
    uploadDocument.mockReturnValue(of(savedDoc('doc-2')));
    component.submit();
    fixture.detectChanges();

    // Um POST no total — o segundo save é PUT da MESMA manutenção. Sem a
    // promoção de `editingId` isto seria uma manutenção duplicada.
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe('mnt-novo');
    // E só `b.pdf` sobe de novo: `a.pdf` já estava no storage.
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect((uploadDocument.mock.calls[0][2] as File).name).toBe('b.pdf');
    expect(component.pendingDocs()).toHaveLength(0);
  });

  // --------------------------------------------------------------- guardas

  it('recusa formato fora da allowlist sem colocar na fila', () => {
    configure(null);

    stage('NOTA_FISCAL', pdf('planilha.xlsx', 1024, 'application/vnd.ms-excel'));

    expect(component.pendingDocs()).toHaveLength(0);
    expect(component.error()).toContain('Formato não suportado');
  });

  it('recusa arquivo acima de 20MB sem colocar na fila', () => {
    configure(null);

    stage('NOTA_FISCAL', pdf('nota.pdf', 21 * 1024 * 1024));

    expect(component.pendingDocs()).toHaveLength(0);
    expect(component.error()).toContain('o limite é 20MB');
  });

  /**
   * INVARIANTE INVERTIDA no FIX-0233 (decisão estrita do usuário): antes uma
   * segunda nota ACRESCENTAVA (peça e mão de obra convivendo); agora UMA por
   * manutenção — a segunda escolha SUBSTITUI a pendente, e quem precisa de
   * mais notas registra manutenções POR EVENTO.
   */
  it('escolher uma segunda nota SUBSTITUI a primeira — uma por manutenção', () => {
    configure(null);

    stage('NOTA_FISCAL', pdf('nota-peca.pdf'));
    stage('NOTA_FISCAL', pdf('nota-mao-de-obra.pdf'));

    expect(component.pendingDocs().map((d) => d.file.name)).toEqual(['nota-mao-de-obra.pdf']);
    expect(pendingRows()).toHaveLength(1);
  });

  it('remover tira o arquivo da fila antes de qualquer envio', () => {
    configure(null);

    stage('NOTA_FISCAL', pdf('a.pdf'));
    stage('OTHER', pdf('b.pdf'));
    const remover = pendingRows()[0].querySelector('button');
    remover?.click();
    fixture.detectChanges();

    expect(component.pendingDocs().map((d) => d.file.name)).toEqual(['b.pdf']);
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  // ------------------------------------------- reescolha do mesmo arquivo

  it('escolher DUAS VEZES o mesmo arquivo no mesmo tipo não duplica a fila', () => {
    configure(null);

    stage('NOTA_FISCAL', pdf('nota-peca.pdf', 1024));
    stage('NOTA_FISCAL', pdf('nota-peca.pdf', 1024));

    // Tocar no slot duas vezes e escolher o mesmo PDF é hesitação, não pedido de
    // duas cópias. Duas linhas aqui virariam nota fiscal duplicada no custo —
    // desde o FIX-0233 quem garante isso é a substituição por tipo.
    expect(component.pendingDocs()).toHaveLength(1);
  });

  /**
   * INVARIANTE INVERTIDA no FIX-0233: a antiga guarda de duplicata por
   * nome+tamanho não existe mais — a substituição por tipo a subsome. O que
   * sobrevive é a independência ENTRE TIPOS: cada slot guarda o seu, e mexer
   * num não mexe no outro. Teto prático da tela: 2 arquivos (1 NF + 1 Outro).
   */
  it('a substituição é POR TIPO — o slot vizinho não é afetado', () => {
    configure(null);

    stage('NOTA_FISCAL', pdf('nota-peca.pdf', 1024));
    // Mesmo nome e tamanho, tipo diferente: anexo distinto, entra no seu slot.
    stage('OTHER', pdf('nota-peca.pdf', 1024));
    expect(component.pendingDocs()).toHaveLength(2);

    // Substituições sucessivas na nota fiscal não tocam no slot "Outro".
    stage('NOTA_FISCAL', pdf('nota-mao-de-obra.pdf', 1024));
    stage('NOTA_FISCAL', pdf('nota-peca.pdf', 2048));

    expect(component.pendingDocs()).toHaveLength(2);
    expect(component.pendingDocs().map((d) => d.kind)).toEqual(['NOTA_FISCAL', 'OTHER']);
    expect(component.pendingDocs().map((d) => d.file.name)).toEqual([
      'nota-peca.pdf',
      'nota-peca.pdf',
    ]);
    expect(component.pendingDocs()[0].file.size).toBe(2048);
  });

  // ------------------------------------- veículo travado após a promoção

  it('depois de criada, o veículo fica desabilitado — o PUT do reenvio não leva vehicleId', () => {
    configure(null);
    uploadDocument.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    expect(component.form.controls.vehicleId.disabled).toBe(false);

    stage('NOTA_FISCAL', pdf('a.pdf'));
    component.submit();
    fixture.detectChanges();

    // A manutenção existe; a tela virou edição de fato. Se o select continuasse
    // habilitado, trocar o veículo e salvar mostraria sucesso e descartaria a
    // troca em silêncio, porque UpdateMaintenanceRequest não carrega vehicleId.
    expect(component.form.controls.vehicleId.disabled).toBe(true);
  });

  // ----------------------------------------------- fila inerte durante o envio

  it('durante o envio não dá para acrescentar nem remover da fila', () => {
    configure(null);
    // Save que nunca completa: `saving()` fica true e a tela fica no meio do envio.
    create.mockReturnValue(new Subject<Maintenance>().asObservable());

    stage('NOTA_FISCAL', pdf('a.pdf'));
    component.submit();
    fixture.detectChanges();
    expect(component.saving()).toBe(true);

    // Os dois controles estão desabilitados no DOM…
    expect(slotButton('NOTA_FISCAL').disabled).toBe(true);
    expect(pendingRows()[0].querySelector('button')?.disabled).toBe(true);

    // …e o gesto é inerte de fato: o toque no slot não arma o seletor, então nem
    // um `change` forjado acrescenta arquivo.
    stage('NOTA_FISCAL', pdf('b.pdf'));
    expect(component.pendingDocs().map((d) => d.file.name)).toEqual(['a.pdf']);

    pendingRows()[0].querySelector('button')?.click();
    fixture.detectChanges();
    expect(component.pendingDocs()).toHaveLength(1);
  });

  // ------------------------------------------------------------- na edição

  it('aberto como EDIÇÃO, o bloco de anexos não existe — quem anexa é o detalhe', () => {
    configure(CREATED);

    expect(host().querySelector('[data-doc-slot="NOTA_FISCAL"]')).toBeNull();
    expect(host().querySelector('input[type="file"]')).toBeNull();
  });
});
