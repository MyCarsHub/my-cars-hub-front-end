import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InspectionCapture } from './inspection-capture';
import { InspectionsService } from '../../services/inspections.service';
import { SessionService } from '../../services/session.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { Inspection, InspectionReviewResult } from '../../types/inspection.types';

/**
 * A tela de FAZER a vistoria — pedido do dono: "dono, motorista e gerenciador".
 *
 * Dois pontos carregam o desenho e por isso tem teste proprio:
 *  - os angulos vem da VISTORIA (retrato do roteiro no dia), nunca de lista fixa;
 *  - o MOTORISTA nao tem galeria, porque uma foto de outro dia destruiria o proposito
 *    do registro. Isso e controle, nao inconsistencia de UI.
 */
describe('InspectionCapture', () => {
  const inspection: Inspection = {
    id: 'insp-1',
    companyId: 'co-1',
    vehicleId: 'veh-1',
    rentalId: null,
    kind: 'FLEET',
    performedBy: 'user-1',
    performedAt: '2026-09-25T12:00:00Z',
    // Vocabulario REAL do backend (`RentalPhotoAngleEnum`): e `BACK`/`LEFT`,
    // nao `REAR`/`LEFT_SIDE`. Fixture que inventa chave testa um mundo que nao existe.
    requiredAngles: ['FRONT', 'BACK', 'LEFT'],
    capturedAngles: [],
  };

  /**
   * A RESPOSTA REAL de `POST /{id}/submit` — `InspectionReviewResponseDto`,
   * campo a campo com o record do backend. NAO e uma `Inspection`: nao tem
   * `requiredAngles` nem `capturedAngles`.
   *
   * ESTE OBJETO E O CONSERTO. O tipo errado em `submit()` era o sintoma; o
   * defeito era o duble devolver uma `Inspection` completa, o que fazia o spec
   * provar o CONTRARIO do que acontece em producao — a tela sobrescrevia a
   * vistoria com a resposta e perdia os angulos, e o teste dizia que estava bem.
   * Um duble que nao copia a forma do servidor nao testa o servidor.
   */
  const SUBMITTED_RESULT: InspectionReviewResult = {
    id: 'insp-1',
    status: 'SUBMITTED',
    scheduleId: null,
    dueAt: null,
    pdfDocumentId: null,
    supersedesId: null,
  };

  let create: ReturnType<typeof vi.fn>;
  let getOne: ReturnType<typeof vi.fn>;
  let uploadPhoto: ReturnType<typeof vi.fn>;
  let submit: ReturnType<typeof vi.fn>;
  let role: string;

  function configure(params: Record<string, string>, query: Record<string, string>): void {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of(inspection));
    getOne = vi.fn().mockReturnValue(of(inspection));
    uploadPhoto = vi.fn().mockReturnValue(of(inspection));
    // O DUBLE DEVOLVE A FORMA DO SERVIDOR, nao uma `Inspection`.
    // Ver `SUBMITTED_RESULT`: a versao anterior devolvia `inspection` aqui e foi
    // isso — nao o tipo — que deixou o defeito passar verde.
    submit = vi.fn().mockReturnValue(of(SUBMITTED_RESULT));

    TestBed.configureTestingModule({
      imports: [InspectionCapture],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: InspectionsService, useValue: { create, getOne, uploadPhoto, submit } },
        { provide: SessionService, useValue: { getCompanyRoleFromToken: () => role } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(params),
              queryParamMap: convertToParamMap(query),
            },
          },
        },
      ],
    });
  }

  function render(): ComponentFixture<InspectionCapture> {
    const fixture = TestBed.createComponent(InspectionCapture);
    fixture.detectChanges();
    return fixture;
  }

  function text(fixture: ComponentFixture<InspectionCapture>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  function galleryInputs(fixture: ComponentFixture<InspectionCapture>): number {
    return (fixture.nativeElement as HTMLElement).querySelectorAll('input[type="file"]').length;
  }

  beforeEach(() => {
    role = 'OWNER';
  });

  it('abre a vistoria a partir do veiculo da query', () => {
    configure({}, { vehicleId: 'veh-1' });
    render();

    expect(create).toHaveBeenCalledWith({ vehicleId: 'veh-1', rentalId: null, kind: 'FLEET' });
  });

  it('sem veiculo nao cria nada e explica o que falta', () => {
    configure({}, {});
    const fixture = render();

    expect(create).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Escolha um veículo');
  });

  /**
   * O roteiro e o da VISTORIA. Se a tela tivesse os 14 angulos fixos no codigo, mudar o
   * roteiro da empresa amanha reescreveria em silencio o que uma vistoria antiga exigia.
   */
  it('usa os angulos que a VISTORIA devolve, nao uma lista fixa', () => {
    configure({}, { vehicleId: 'veh-1' });
    const fixture = render();

    const body = text(fixture);
    expect(body).toContain('0 de 3 fotos');
    expect(body).toContain('Frente');
    expect(body).toContain('Traseira');
    expect(body).toContain('Lateral esquerda');
  });

  it('um roteiro DIFERENTE produz uma tela diferente, sem tocar no codigo', () => {
    configure({}, { vehicleId: 'veh-1' });
    create.mockReturnValue(
      of({ ...inspection, requiredAngles: ['PAINEL', 'PNEU_DIANTEIRO'], capturedAngles: [] }),
    );
    const fixture = render();

    expect(text(fixture)).toContain('0 de 2 fotos');
    expect(text(fixture)).toContain('Painel');
  });

  /** RETOMADA: o que ja subiu nao e pedido de novo. */
  it('vistoria pela metade retoma no que falta', () => {
    configure({ id: 'insp-1' }, {});
    getOne.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT'] }));
    const fixture = render();

    expect(getOne).toHaveBeenCalledWith('insp-1');
    expect(text(fixture)).toContain('1 de 3 fotos');
    // O botao principal aponta o PROXIMO pendente, nao o primeiro do roteiro.
    expect(text(fixture)).toContain('Fotografar: Traseira');
  });

  it('com todos os angulos fotografados mostra o estado de concluida', () => {
    configure({ id: 'insp-1' }, {});
    getOne.mockReturnValue(
      of({ ...inspection, capturedAngles: ['FRONT', 'BACK', 'LEFT'] }),
    );
    const fixture = render();

    expect(text(fixture)).toContain('3 de 3 fotos');
    expect(text(fixture)).toContain('Vistoria completa');
  });

  /**
   * A REGRA DO DONO, 21/09: "O motorista deve somente tirar foto NO MOMENTO. O dono e o
   * gerenciador podem tirar foto OU escolher da galeria."
   */
  it('MOTORISTA nao tem galeria — so camera', () => {
    role = 'DRIVER';
    configure({}, { vehicleId: 'veh-1' });
    const fixture = render();

    expect(galleryInputs(fixture)).toBe(0);
    expect(text(fixture)).toContain('Fotografar');
  });

  it('OWNER e MANAGER tem galeria em cada angulo', () => {
    for (const actor of ['OWNER', 'MANAGER']) {
      role = actor;
      configure({}, { vehicleId: 'veh-1' });
      const fixture = render();

      expect(galleryInputs(fixture), `galeria para ${actor}`).toBe(3);
    }
  });

  /** O 403 e a regra de quem vistoria o que — nao pode chegar como erro cru. */
  it('403 explica a regra em vez de mostrar erro cru', () => {
    configure({}, { vehicleId: 'veh-1' });
    create.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    const fixture = render();

    const body = text(fixture);
    expect(body).toContain('aluguel ativo');
    expect(body).toContain('não pode vistoriar este veículo');
  });

  /**
   * Uma foto por vez: uma falha custa UMA foto, e as anteriores ja estao no servidor.
   * Este teste fixa que a tela nao acumula para enviar no fim.
   */
  it('falha de UMA foto nao derruba a tela nem perde o progresso', () => {
    configure({ id: 'insp-1' }, {});
    getOne.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT'] }));
    const fixture = render();

    uploadPhoto.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const cmp = fixture.componentInstance as unknown as {
      onFilePicked: (e: Event, angle: string) => void;
    };
    const file = new File(['x'], 'f.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    cmp.onFilePicked({ target: input } as unknown as Event, 'BACK');
    fixture.detectChanges();

    // O progresso conquistado continua na tela.
    expect(text(fixture)).toContain('1 de 3 fotos');
    expect(text(fixture)).toContain('Não foi possível enviar esta foto');
  });

  it('a foto sobe no angulo escolhido e a tela adota o que o servidor devolve', () => {
    configure({ id: 'insp-1' }, {});
    const fixture = render();

    uploadPhoto.mockReturnValue(of({ ...inspection, capturedAngles: ['BACK'] }));
    const cmp = fixture.componentInstance as unknown as {
      onFilePicked: (e: Event, angle: string) => void;
    };
    const file = new File(['x'], 'f.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    cmp.onFilePicked({ target: input } as unknown as Event, 'BACK');
    fixture.detectChanges();

    expect(uploadPhoto).toHaveBeenCalledWith('insp-1', 'BACK', file);
    expect(text(fixture)).toContain('1 de 3 fotos');
  });
  /**
   * O FECHAMENTO DA VISTORIA, e o motivo de ele existir: ninguem fechava.
   *
   * Medido junto com o backend — nenhuma tela chamava `POST /{id}/submit`, e
   * `COMPLETED` so e alcancavel por `submit` seguido de `approve`. Logo nenhuma
   * vistoria fechava, para NENHUM papel: nem o dono operando. O circulo faltava
   * dos dois lados, e este bloco fecha o lado do frontend.
   *
   * Tres invariantes, e a ordem reflete o risco:
   *
   * 1. NAO envia sozinho. Enviar e irreversivel do ponto de vista da pessoa —
   *    depois dela o dono aprova ou recusa, e ela nao fotografa mais nada ali.
   *    Acao dessa natureza nao acontece como efeito colateral de ter tirado a
   *    ultima foto.
   * 2. NAO envia incompleto. O botao nem existe com angulo faltando.
   * 3. O caminho de ERRO nao mente nos dois sentidos. As fotos JA ESTAO salvas
   *    (sobem uma a uma), entao a falha do envio nao perdeu trabalho — e a tela
   *    nao pode sugerir que perdeu, nem sugerir que enviou quando nao enviou.
   */
  describe('fechar a vistoria', () => {
    const complete: Inspection = {
      ...inspection,
      capturedAngles: ['FRONT', 'BACK', 'LEFT'],
    };

    function renderComplete(): ComponentFixture<InspectionCapture> {
      configure({ id: 'insp-1' }, {});
      getOne.mockReturnValue(of(complete));
      return render();
    }

    const submitButton = (fixture: ComponentFixture<InspectionCapture>) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
        '[data-submit-inspection]',
      );

    it('NAO oferece envio com angulo faltando', () => {
      configure({ id: 'insp-1' }, {});
      getOne.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT', 'BACK'] }));
      const fixture = render();

      expect(submitButton(fixture)).toBeNull();
      expect(submit).not.toHaveBeenCalled();
    });

    it('com o roteiro completo oferece um botao EXPLICITO de finalizar', () => {
      const fixture = renderComplete();

      const button = submitButton(fixture);
      expect(button).not.toBeNull();
      expect(button?.textContent ?? '').toContain('Finalizar');
    });

    /** O invariante 1: completar NAO e enviar. */
    it('NAO envia sozinho ao completar o roteiro — so no clique', () => {
      const fixture = renderComplete();

      expect(submit).not.toHaveBeenCalled();

      submitButton(fixture)?.click();
      fixture.detectChanges();

      expect(submit).toHaveBeenCalledWith('insp-1');
    });

    it('avisa que o envio e irreversivel ANTES do clique', () => {
      const fixture = renderComplete();

      expect(text(fixture)).toContain('não poderá');
    });

    it('enquanto envia mostra carregando e nao envia duas vezes', () => {
      const pending = new Subject<Inspection>();
      const fixture = renderComplete();
      submit.mockReturnValue(pending);

      submitButton(fixture)?.click();
      fixture.detectChanges();

      expect(submitButton(fixture)?.textContent ?? '').toContain('Enviando');
      submitButton(fixture)?.click();
      fixture.detectChanges();

      expect(submit).toHaveBeenCalledTimes(1);
    });

    it('enviada: confirma, tira o botao e encerra as refotos', () => {
      const fixture = renderComplete();

      submitButton(fixture)?.click();
      fixture.detectChanges();

      expect(text(fixture)).toContain('enviada');
      expect(submitButton(fixture)).toBeNull();
      // Ela nao fotografa mais nada nesta vistoria a menos que seja recusada;
      // oferecer refoto seria prometer o que o servidor vai recusar.
      expect(galleryInputs(fixture)).toBe(0);
    });

    /**
     * A REGRESSAO que o duble mentiroso escondia: a resposta do envio nao tem
     * angulo nenhum, entao adota-la como vistoria esvaziaria o progresso. Com o
     * duble devolvendo a forma certa, este teste falha se alguem voltar a fazer
     * `inspection.set(result)`.
     */
    it('o envio NAO apaga o progresso: os angulos sobrevivem a resposta', () => {
      const fixture = renderComplete();

      submitButton(fixture)?.click();
      fixture.detectChanges();

      expect(text(fixture)).toContain('3 de 3 fotos');
    });

    /**
     * O invariante 3, e o teste que mais importa deste bloco. A frase precisa
     * negar as DUAS leituras erradas: "perdi as fotos" e "ja enviei".
     */
    it('falha no envio: nao diz que enviou, e garante que as fotos estao salvas', () => {
      const fixture = renderComplete();
      submit.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      submitButton(fixture)?.click();
      fixture.detectChanges();

      const shown = text(fixture);
      expect(shown).toContain('fotos');
      expect(shown).toContain('salvas');
      expect(shown).not.toContain('Vistoria enviada');
      // O botao FICA: falha de envio e retentavel, e o trabalho nao se perdeu.
      expect(submitButton(fixture)).not.toBeNull();
    });

    /**
     * O backend ainda recusa o MOTORISTA em `submit` enquanto o recorte dele nao
     * sobe. Isso e ESPERADO — a tela explica a regra em vez de mascarar o 403 ou
     * fingir que enviou.
     */
    it('403 no envio explica a regra em vez de erro cru', () => {
      role = 'DRIVER';
      const fixture = renderComplete();
      submit.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

      submitButton(fixture)?.click();
      fixture.detectChanges();

      const shown = text(fixture);
      expect(shown).not.toContain('Vistoria enviada');
      expect(shown.toLowerCase()).toContain('permiss');
    });
  });
  /**
   * MEDIUM-1 — A FOTO RECEM-TIRADA NAO PODE SE PERDER NO ERRO.
   *
   * Na rua, em 3G, falha de upload e o caso COMUM. Se "tente de novo"
   * significasse reabrir a camera, a pessoa refotografaria o mesmo angulo a
   * cada falha — tres vezes e ela conclui que o aplicativo nao funciona, e
   * esta certa.
   *
   * O arquivo ja esta na memoria: reenviar O MESMO e de graca.
   */
  describe('reenvio da foto que falhou', () => {
    const retryBtn = (f: ComponentFixture<InspectionCapture>) =>
      (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-retry-upload]');

    function failUpload(): ComponentFixture<InspectionCapture> {
      configure({ id: 'insp-1' }, {});
      const fixture = render();
      uploadPhoto.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      const file = new File(['x'], 'frente.jpg', { type: 'image/jpeg' });
      const cmp = fixture.componentInstance as unknown as {
        openCamera(a: string): void;
        onCaptured(f: File): void;
      };
      // A camera precisa estar aberta: `onCaptured` le o angulo de `activeAngle`.
      cmp.openCamera('FRONT');
      cmp.onCaptured(file);
      fixture.detectChanges();
      return fixture;
    }

    it('apos a falha, oferece REENVIAR — nao refotografar', () => {
      const fixture = failUpload();

      expect(retryBtn(fixture)).not.toBeNull();
      expect(retryBtn(fixture)?.textContent ?? '').toContain('Reenviar');
    });

    it('o reenvio manda O MESMO arquivo, sem abrir a camera', () => {
      const fixture = failUpload();
      const sentFirst = uploadPhoto.mock.calls[0][2] as File;

      uploadPhoto.mockReturnValue(of(inspection));
      retryBtn(fixture)?.click();
      fixture.detectChanges();

      expect(uploadPhoto).toHaveBeenCalledTimes(2);
      const sentAgain = uploadPhoto.mock.calls[1][2] as File;
      expect(sentAgain).toBe(sentFirst);
      // Mesmo angulo, e NENHUMA camera aberta: reenviar nao e refotografar.
      expect(uploadPhoto.mock.calls[1][1]).toBe(uploadPhoto.mock.calls[0][1]);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('app-live-camera-sheet'),
      ).toBeNull();
    });

    it('reenvio bem-sucedido limpa o erro e o pendente', () => {
      const fixture = failUpload();

      uploadPhoto.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT'] }));
      retryBtn(fixture)?.click();
      fixture.detectChanges();

      expect(retryBtn(fixture)).toBeNull();
      expect(text(fixture)).toContain('1 de 3 fotos');
    });

    it('fotografar de novo continua possivel — so nao e a unica saida', () => {
      const fixture = failUpload();
      const cmp = fixture.componentInstance as unknown as { openCamera(a: string): void };

      cmp.openCamera('FRONT');
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('app-live-camera-sheet'),
      ).not.toBeNull();
    });
  });
  /**
   * LOW-2 — a navegacao recusada nao pode ficar muda.
   *
   * `void router.navigate(...)` engolia os DOIS modos de falha: `false` (um
   * guard recusou) e a rejeicao da promessa. Nos dois a pessoa olhava uma tela
   * que nao mudou, sem nada a fazer — a mesma familia do convite que ficou
   * girando para sempre.
   *
   * A vistoria JA FOI CRIADA quando isto acontece: o que falha e so o
   * endereco, e o que se perde e a retomada. Por isso a mensagem manda
   * continuar por ali e NAO recarregar.
   */
  describe('navegacao apos criar a vistoria', () => {
    function renderWithNavigate(
      navigate: () => Promise<boolean>,
    ): ComponentFixture<InspectionCapture> {
      configure({}, { vehicleId: 'veh-1' });
      const router = TestBed.inject(Router);
      vi.spyOn(router, 'navigate').mockImplementation(navigate as never);
      return render();
    }

    it('guard que RECUSA (false) vira mensagem acionavel, nao silencio', async () => {
      const fixture = renderWithNavigate(() => Promise.resolve(false));
      await fixture.whenStable();
      fixture.detectChanges();

      const shown = text(fixture);
      expect(shown).toContain('não recarregue');
      // A tela continua utilizavel: a vistoria existe e os angulos estao la.
      expect(shown).toContain('0 de 3 fotos');
    });

    it('promessa REJEITADA tambem e tratada', async () => {
      const fixture = renderWithNavigate(() => Promise.reject(new Error('boom')));
      await fixture.whenStable();
      // O ramo rejeitado passa por `.then` ANTES de chegar ao `.catch`, entao
      // precisa de um tick de microtarefa a mais que o ramo `false`. Em
      // producao a diferenca nao existe; aqui ela decide se o teste ve o efeito.
      await Promise.resolve();
      fixture.detectChanges();

      expect(text(fixture)).toContain('não recarregue');
    });

    it('navegacao OK nao mostra aviso nenhum', async () => {
      const fixture = renderWithNavigate(() => Promise.resolve(true));
      await fixture.whenStable();
      fixture.detectChanges();

      expect(text(fixture)).not.toContain('não recarregue');
    });
  });
});
