import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InspectionCapture } from './inspection-capture';
import { ImageCompressionService } from '../../services/image-compression.service';
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
  let photos: ReturnType<typeof vi.fn>;
  let submit: ReturnType<typeof vi.fn>;
  let recapture: ReturnType<typeof vi.fn>;
  let compress: ReturnType<typeof vi.fn>;
  let role: string;

  function configure(params: Record<string, string>, query: Record<string, string>): void {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of(inspection));
    getOne = vi.fn().mockReturnValue(of(inspection));
    uploadPhoto = vi.fn().mockReturnValue(of(inspection));
    // A tela passou a LER a lista de fotos para mostrar a miniatura real. Sem este
    // dobro, `service.photos` e `undefined` e a chamada estoura DENTRO de um subscribe
    // — erro que o runner relata e nao reprova, entao a suite ficaria verde sobre um
    // caminho quebrado.
    photos = vi.fn().mockReturnValue(of([]));
    // O DUBLE DEVOLVE A FORMA DO SERVIDOR, nao uma `Inspection`.
    // Ver `SUBMITTED_RESULT`: a versao anterior devolvia `inspection` aqui e foi
    // isso — nao o tipo — que deixou o defeito passar verde.
    submit = vi.fn().mockReturnValue(of(SUBMITTED_RESULT));
    recapture = vi.fn().mockReturnValue(of({ ...inspection, id: 'insp-2', capturedAngles: [] }));
    // A compressao e ASSINCRONA e nunca lanca; o duble devolve o proprio arquivo, que e o
    // que o servico real faz quando nao decodifica a imagem.
    compress = vi.fn((file: File) => Promise.resolve(file));

    TestBed.configureTestingModule({
      imports: [InspectionCapture],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: InspectionsService,
          useValue: { create, getOne, uploadPhoto, submit, photos, recapture },
        },
        { provide: ImageCompressionService, useValue: { compress } },
        { provide: SessionService, useValue: { getCompanyRoleFromToken: () => role } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap(params),
              queryParamMap: convertToParamMap(query),
            },
            // A tela ouve o OBSERVAVEL: depois de refazer, o id da URL troca e a mesma
            // instancia e reaproveitada pelo roteador.
            paramMap: of(convertToParamMap(params)),
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

  /**
   * Deixa a compressao (uma promessa) terminar e repinta. O envio agora passa por um
   * `await` antes de chegar a rede, entao quem afirma sobre o upload espera aqui.
   */
  async function flush(fixture: ComponentFixture<InspectionCapture>): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
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

    /*
     * A ORDEM DEIXOU DE SER IMPOSTA. Antes havia um botao principal apontando o PROXIMO
     * pendente, e este caso afirmava o texto dele ("Fotografar: Traseira").
     *
     * A grade do card de aluguel aceita qualquer ordem, entao o que se afirma agora e que
     * TODO angulo tem o seu proprio alvo — inclusive os que ja tem foto, porque refazer uma
     * foto e um caso de uso real e nao um desvio.
     */
    const alvos = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button[aria-label]'),
    ).map((b) => b.getAttribute('aria-label'));
    expect(alvos).toContain('Refazer foto: Frente');
    expect(alvos).toContain('Fotografar: Traseira');
    expect(alvos).toContain('Fotografar: Lateral esquerda');
  });

  it('com todos os angulos fotografados mostra o estado de concluida', () => {
    configure({ id: 'insp-1' }, {});
    getOne.mockReturnValue(
      of({ ...inspection, capturedAngles: ['FRONT', 'BACK', 'LEFT'] }),
    );
    const fixture = render();

    expect(text(fixture)).toContain('3 de 3 fotos');
    // A contagem e o estado vivem no cabecalho do card; a barra de progresso de pagina saiu,
    // porque o card de aluguel nao tem nenhuma.
    expect(text(fixture)).toContain('completa');
  });

  /**
   * A REGRA DO DONO, 21/09: "O motorista deve somente tirar foto NO MOMENTO. O dono e o
   * gerenciador podem tirar foto OU escolher da galeria."
   */
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
  it('falha de UMA foto nao derruba a tela nem perde o progresso', async () => {
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
    await flush(fixture);

    // O progresso conquistado continua na tela.
    expect(text(fixture)).toContain('1 de 3 fotos');
    expect(text(fixture)).toContain('Não foi possível enviar esta foto');
  });

  it('a foto sobe no angulo escolhido e a tela adota o que o servidor devolve', async () => {
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
    await flush(fixture);

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

    const odometerField = (fixture: ComponentFixture<InspectionCapture>) =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('[data-odometer]');

    /** Digita o hodometro como a pessoa digita: no campo, evento `input`. */
    function typeOdometer(fixture: ComponentFixture<InspectionCapture>, value = '82109'): void {
      const input = odometerField(fixture);
      if (!input) throw new Error('campo de hodometro nao renderizado');
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

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

      typeOdometer(fixture);
      submitButton(fixture)?.click();
      fixture.detectChanges();

      expect(submit).toHaveBeenCalledWith('insp-1', { odometerKm: 82109 });
    });

    it('avisa que o envio e irreversivel ANTES do clique', () => {
      const fixture = renderComplete();

      expect(text(fixture)).toContain('não poderá');
    });

    it('enquanto envia mostra carregando e nao envia duas vezes', () => {
      const pending = new Subject<Inspection>();
      const fixture = renderComplete();
      submit.mockReturnValue(pending);

      typeOdometer(fixture);
      submitButton(fixture)?.click();
      fixture.detectChanges();

      expect(submitButton(fixture)?.textContent ?? '').toContain('Enviando');
      submitButton(fixture)?.click();
      fixture.detectChanges();

      expect(submit).toHaveBeenCalledTimes(1);
    });

    it('enviada: confirma, tira o botao e encerra as refotos', () => {
      const fixture = renderComplete();

      typeOdometer(fixture);
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

      typeOdometer(fixture);
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

      typeOdometer(fixture);
      submitButton(fixture)?.click();
      fixture.detectChanges();

      const shown = text(fixture);
      expect(shown).toContain('fotos');
      expect(shown).toContain('salvas');
      expect(shown).not.toContain('Vistoria enviada');
      // O botao FICA: falha de envio e retentavel, e o trabalho nao se perdeu.
      expect(submitButton(fixture)).not.toBeNull();
    });

    // ================= O HODOMETRO ATUAL, pedido antes de enviar =================
    /**
     * O motorista informa o hodometro ao enviar: sem ele o dono nao consegue aprovar e a
     * vistoria voltaria para ser refeita so por isso. O campo e obrigatorio NA TELA, mesmo
     * sendo opcional no servidor (compatibilidade com o app antigo).
     */
    describe('hodometro atual', () => {
      const errorText = (fixture: ComponentFixture<InspectionCapture>) =>
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent ?? '';

      it('o campo esta na tela com o roteiro completo, antes do botao de enviar', () => {
        const fixture = renderComplete();
        const input = odometerField(fixture)!;
        const html = (fixture.nativeElement as HTMLElement).innerHTML;

        expect(input).not.toBeNull();
        expect(html.indexOf('data-odometer')).toBeLessThan(html.indexOf('data-submit-inspection'));
        expect(text(fixture)).toContain('Hodômetro atual (km)');
      });

      it('NAO aparece com angulo faltando — nao ha o que enviar ainda', () => {
        configure({ id: 'insp-1' }, {});
        getOne.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT'] }));
        const fixture = render();

        expect(odometerField(fixture)).toBeNull();
      });

      it('e numerico, de texto e de 16px: abaixo disso o iOS da zoom ao focar', () => {
        const fixture = renderComplete();
        const input = odometerField(fixture)!;

        expect(input.getAttribute('inputmode')).toBe('numeric');
        // Texto, nao `type=number`: o campo aceita o ponto de milhar pt-BR.
        expect(input.getAttribute('type')).toBe('text');
        expect(input.className).toContain('text-base');
        expect(input.className).not.toMatch(/text-(xs|sm)/);
        expect(input.className).toContain('min-h-12');
      });

      it('e obrigatorio: sem ele nada e enviado e a frase aparece no campo', () => {
        const fixture = renderComplete();

        submitButton(fixture)?.click();
        fixture.detectChanges();

        expect(submit).not.toHaveBeenCalled();
        expect(errorText(fixture)).toContain('Informe o hodômetro atual do carro.');
        expect(odometerField(fixture)?.getAttribute('aria-invalid')).toBe('true');
      });

      it('espacos nao contam como preenchido', () => {
        const fixture = renderComplete();
        typeOdometer(fixture, '   ');

        submitButton(fixture)?.click();
        fixture.detectChanges();

        expect(submit).not.toHaveBeenCalled();
      });

      it('recusa o que nao e inteiro positivo, com a frase do que corrigir', () => {
        const cases: Array<[string, string]> = [
          ['abc', 'Digite só os números do hodômetro'],
          ['45.99', 'Digite só os números do hodômetro'],
          ['82109,5', 'Digite só os números do hodômetro'],
          ['-100', 'Digite só os números do hodômetro'],
          ['0', 'maior que zero'],
          ['5000001', 'limite de 5.000.000 km'],
        ];
        for (const [value, expected] of cases) {
          const fixture = renderComplete();
          typeOdometer(fixture, value);

          submitButton(fixture)?.click();
          fixture.detectChanges();

          expect(submit, `"${value}" foi enviado`).not.toHaveBeenCalled();
          expect(errorText(fixture), `"${value}"`).toContain(expected);
        }
      });

      it('aceita o ponto de milhar pt-BR e envia o numero inteiro', () => {
        const fixture = renderComplete();
        typeOdometer(fixture, '82.109');

        submitButton(fixture)?.click();
        fixture.detectChanges();

        expect(submit).toHaveBeenCalledWith('insp-1', { odometerKm: 82109 });
      });

      it('o teto do servidor (5.000.000) ainda vale', () => {
        const fixture = renderComplete();
        typeOdometer(fixture, '5000000');

        submitButton(fixture)?.click();
        fixture.detectChanges();

        expect(submit).toHaveBeenCalledWith('insp-1', { odometerKm: 5_000_000 });
      });

      it('mostra o ultimo registro do veiculo quando o servidor o manda', () => {
        configure({ id: 'insp-1' }, {});
        getOne.mockReturnValue(of({ ...complete, previousOdometerKm: 81420 }));
        const fixture = render();

        expect(text(fixture)).toContain('Último registro do veículo: 81.420 km.');
      });

      /**
       * `INSPECTION_ODOMETER_BELOW_PREVIOUS` etc. chegam com `message` em portugues: a tela a
       * mostra, em vez de uma frase generica que esconde o que a pessoa precisa corrigir.
       */
      it('mostra a mensagem do servidor quando ele recusa o hodometro', () => {
        const fixture = renderComplete();
        submit.mockReturnValue(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: {
                  message: 'O hodômetro (80.000 km) não pode ser menor que o da retirada (81.420 km).',
                  code: 'INSPECTION_ODOMETER_BELOW_PREVIOUS',
                },
              }),
          ),
        );
        typeOdometer(fixture, '80000');

        submitButton(fixture)?.click();
        fixture.detectChanges();

        expect(text(fixture)).toContain('não pode ser menor que o da retirada');
        expect(text(fixture)).not.toContain('Vistoria enviada');
        // O que a pessoa digitou fica, e o envio pode ser tentado de novo.
        expect(odometerField(fixture)?.value).toBe('80000');
        expect(submitButton(fixture)).not.toBeNull();
      });

      it('mostra a mensagem quando faltam fotos no servidor (INSPECTION_MISSING_ANGLES)', () => {
        const fixture = renderComplete();
        submit.mockReturnValue(
          throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: {
                  message: 'Faltam fotos: Hodômetro.',
                  code: 'INSPECTION_MISSING_ANGLES',
                },
              }),
          ),
        );
        typeOdometer(fixture);

        submitButton(fixture)?.click();
        fixture.detectChanges();

        expect(text(fixture)).toContain('Faltam fotos: Hodômetro.');
      });
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

    async function failUpload(): Promise<ComponentFixture<InspectionCapture>> {
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
      await flush(fixture);
      return fixture;
    }

    it('apos a falha, oferece REENVIAR — nao refotografar', async () => {
      const fixture = await failUpload();

      expect(retryBtn(fixture)).not.toBeNull();
      expect(retryBtn(fixture)?.textContent ?? '').toContain('Reenviar');
    });

    it('o reenvio manda O MESMO arquivo, sem abrir a camera', async () => {
      const fixture = await failUpload();
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

    it('reenvio bem-sucedido limpa o erro e o pendente', async () => {
      const fixture = await failUpload();

      uploadPhoto.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT'] }));
      retryBtn(fixture)?.click();
      fixture.detectChanges();

      expect(retryBtn(fixture)).toBeNull();
      expect(text(fixture)).toContain('1 de 3 fotos');
    });

    it('fotografar de novo continua possivel — so nao e a unica saida', async () => {
      const fixture = await failUpload();
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
  // =============== A MINIATURA REAL (o conserto que o dono pediu) ===============
  /**
   * O DEFEITO: a foto nunca voltava para a tela. O retorno era um circulo de 32px com um
   * check numa lista de uma coluna, enquanto o card de aluguel mostra a MINIATURA da foto
   * tirada. Quem fotografa 14 angulos em pe ao redor do carro nao tinha como conferir o que
   * registrou.
   *
   * A tela tambem nao buscava foto nenhuma — `done` vinha de `capturedAngles` — entao a
   * miniatura exigiu passar a LER `GET /inspections/{id}/photos`. Estes casos pinam as duas
   * metades: a leitura e a exibicao.
   */
  it('le as fotos da vistoria e mostra a miniatura real no quadro', () => {
    configure({ id: 'insp-1' }, {});
    getOne.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT'] }));
    photos.mockReturnValue(
      of([{ id: 'p1', angle: 'FRONT', label: 'Frente', signedUrl: 'https://x/frente.jpg' }]),
    );
    const fixture = render();

    expect(photos).toHaveBeenCalledWith('insp-1');
    const imgs = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('img'),
    ).map((i) => i.getAttribute('src'));
    expect(imgs).toContain('https://x/frente.jpg');
  });

  /**
   * A FOTO EXISTE e a assinatura nao veio — o contrato permite `signedUrl` nula com a foto
   * presente, e o review ja trata assim. Dizer "sem foto" mandaria refotografar o que esta
   * no servidor: punir quem fez certo por uma falha nossa.
   */
  it('angulo com foto e sem URL assinada diz que a foto existe, nao que falta', () => {
    configure({ id: 'insp-1' }, {});
    getOne.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT'] }));
    photos.mockReturnValue(
      of([{ id: 'p1', angle: 'FRONT', label: 'Frente', signedUrl: null }]),
    );
    const fixture = render();

    expect(text(fixture)).toContain('Foto enviada');
    expect(text(fixture)).not.toContain('sem foto');
  });

  /** A GRADE, e nao a lista de uma coluna: a forma do card de aluguel, ponto a ponto. */
  it('desenha os angulos em GRADE de 2/3/4 colunas, nao em lista', () => {
    configure({}, { vehicleId: 'veh-1' });
    const fixture = render();
    const host = fixture.nativeElement as HTMLElement;

    const grade = host.querySelector('.grid.grid-cols-2');
    expect(grade, 'a grade do card de aluguel nao esta na tela').not.toBeNull();
    expect(grade?.className).toContain('sm:grid-cols-3');
    expect(grade?.className).toContain('lg:grid-cols-4');
    // E cada quadro e quadrado, como o do aluguel — nao uma linha de altura livre.
    expect(host.querySelectorAll('.aspect-square').length).toBe(3);
    // A lista de uma coluna saiu.
    expect(host.querySelector('ul')).toBeNull();
  });

  // ====================== O ESTADO DA VISTORIA MANDA NA TELA ======================
  /**
   * O DEFEITO: a tela de captura nao sabia o `status`. Uma vistoria ja enviada, aprovada
   * ou recusada reabria com as camera/galeria de uma PENDING — o servidor recusava a foto
   * (so `PENDING` aceita) e a recusa era um beco sem saida: nem o motivo nem como refazer.
   */
  describe('estado da vistoria', () => {
    const all = ['FRONT', 'BACK', 'LEFT'];

    function renderWith(
      extra: Partial<Inspection>,
      signedPhotos: unknown[] = [],
    ): ComponentFixture<InspectionCapture> {
      // `configure` recria os dobles: o que a tela le tem de ser definido DEPOIS dele.
      configure({ id: 'insp-1' }, {});
      getOne.mockReturnValue(of({ ...inspection, capturedAngles: all, ...extra }));
      photos.mockReturnValue(of(signedPhotos));
      return render();
    }

    const targets = (fixture: ComponentFixture<InspectionCapture>): string[] =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button[aria-label]'),
      ).map((b) => b.getAttribute('aria-label') ?? '');

    const submitBtn = (fixture: ComponentFixture<InspectionCapture>) =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-submit-inspection]');

    it('PENDING fotografa: tem camera e galeria', () => {
      const fixture = renderWith({ status: 'PENDING', capturedAngles: ['FRONT'] });

      expect(targets(fixture)).toContain('Fotografar: Traseira');
      expect(galleryInputs(fixture)).toBe(3);
    });

    it('SUBMITTED so mostra: nenhuma camera, nenhuma galeria, nenhum finalizar', () => {
      const fixture = renderWith({ status: 'SUBMITTED' });

      expect(targets(fixture).filter((l) => /^(Fotografar|Refazer foto)/.test(l))).toEqual([]);
      expect(galleryInputs(fixture)).toBe(0);
      expect(submitBtn(fixture)).toBeNull();
      expect(text(fixture)).toContain('aguardam a decisão');
      expect(text(fixture)).toContain('3 de 3 fotos');
    });

    it('APPROVED diz que foi aprovada e mantem as fotos a vista', () => {
      const fixture = renderWith({ status: 'APPROVED', reviewedAt: '2026-09-26T12:00:00Z' }, [
        { id: 'p1', angle: 'FRONT', signedUrl: 'https://x/frente.jpg' },
      ]);

      expect(text(fixture)).toContain('Vistoria aprovada');
      expect(galleryInputs(fixture)).toBe(0);
      const imgs = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('img'),
      ).map((i) => i.getAttribute('src'));
      expect(imgs).toContain('https://x/frente.jpg');
    });

    it('REJECTED mostra o MOTIVO e oferece refazer — sem camera', () => {
      const fixture = renderWith({
        status: 'REJECTED',
        rejectionReason: 'Foto do painel desfocada.',
        reviewedAt: '2026-09-26T12:00:00Z',
      });

      expect(text(fixture)).toContain('Esta vistoria foi recusada');
      expect(text(fixture)).toContain('Foto do painel desfocada.');
      const btn = (fixture.nativeElement as HTMLElement).querySelector('[data-recapture]');
      expect(btn?.textContent ?? '').toContain('Refazer vistoria');
      expect(targets(fixture).filter((l) => /^(Fotografar|Refazer foto)/.test(l))).toEqual([]);
    });

    it('REJECTED sem motivo no payload nao inventa um', () => {
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: null });

      expect(text(fixture)).toContain('não foi informado');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-rejection-reason]'),
      ).toBeNull();
    });

    it('Refazer chama recapture e passa a operar na vistoria NOVA, em branco', () => {
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: 'Fora de foco.' });
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('[data-recapture]')
        ?.click();
      fixture.detectChanges();

      expect(recapture).toHaveBeenCalledWith('insp-1');
      expect(navigate).toHaveBeenCalledWith(['/vistorias', 'insp-2', 'captura'], {
        replaceUrl: true,
      });
      // Nova, PENDING e zerada: volta a fotografar e a recusa some.
      expect(text(fixture)).toContain('0 de 3 fotos');
      expect(text(fixture)).not.toContain('Esta vistoria foi recusada');
      expect(targets(fixture)).toContain('Fotografar: Frente');
    });

    it('Refazer nao dispara duas vezes no toque repetido', () => {
      const pending = new Subject<Inspection>();
      const fixture = renderWith({ status: 'REJECTED' });
      recapture.mockReturnValue(pending);
      const btn = () =>
        (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-recapture]');

      btn()?.click();
      fixture.detectChanges();
      btn()?.click();
      fixture.detectChanges();

      expect(recapture).toHaveBeenCalledTimes(1);
      expect(btn()?.textContent ?? '').toContain('Abrindo nova vistoria');
    });

    it('falha ao refazer explica e deixa a recusa na tela, retentavel', () => {
      const fixture = renderWith({ status: 'REJECTED', rejectionReason: 'Fora de foco.' });
      recapture.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('[data-recapture]')
        ?.click();
      fixture.detectChanges();

      expect(text(fixture)).toContain('Não foi possível refazer');
      expect(text(fixture)).toContain('Fora de foco.');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-recapture]'),
      ).not.toBeNull();
    });

    /**
     * Um servidor anterior a esta mudanca nao manda `status`. "Ausente" nao pode virar
     * tela quebrada nem somente leitura: cai no comportamento de antes, que e fotografar.
     */
    it('sem status no payload, degrada para captura', () => {
      const fixture = renderWith({ capturedAngles: ['FRONT'] });

      expect(targets(fixture)).toContain('Fotografar: Traseira');
      expect(galleryInputs(fixture)).toBe(3);
    });

    it('o titulo acompanha o estado', () => {
      expect(text(renderWith({ status: 'PENDING' }))).toContain('Fazer vistoria');
      expect(text(renderWith({ status: 'REJECTED' }))).toContain('Vistoria recusada');
    });
  });

  // ============ O PASSO DE FINALIZAR DIZ O QUE FALTA ============
  describe('finalizar com angulos faltando', () => {
    function renderMissing(captured: string[]): ComponentFixture<InspectionCapture> {
      configure({ id: 'insp-1' }, {});
      getOne.mockReturnValue(of({ ...inspection, capturedAngles: captured, status: 'PENDING' }));
      return render();
    }

    it('nomeia QUAIS angulos faltam, em vez de sumir', () => {
      const fixture = renderMissing(['FRONT']);

      const body = text(fixture);
      expect(body).toContain('Finalizar a vistoria');
      expect(body).toContain('Faltam 2 fotos');
      const missing = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('[data-missing-angle]'),
      ).map((b) => (b.textContent ?? '').trim());
      expect(missing).toEqual(['Traseira', 'Lateral esquerda']);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-submit-inspection]'),
      ).toBeNull();
    });

    it('singular quando falta uma so', () => {
      expect(text(renderMissing(['FRONT', 'BACK']))).toContain('Falta 1 foto');
    });

    it('tocar no angulo que falta abre a camera dele', () => {
      const fixture = renderMissing(['FRONT']);

      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLButtonElement>('[data-missing-angle]')
        ?.click();
      fixture.detectChanges();

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('app-live-camera-sheet'),
      ).not.toBeNull();
    });
  });

  // ============ COMPRESSAO ANTES DO UPLOAD, E ERRO POR FOTO ============
  /**
   * O celular produz fotos de 10-20 MB e o backend recusa acima de 8 MB. Subir o original
   * era perder a foto na rede para ouvir um 413 — a compressao tem de acontecer ANTES, e o
   * que sobe e o arquivo comprimido.
   */
  describe('envio da foto', () => {
    function pick(fixture: ComponentFixture<InspectionCapture>, file: File, angle: string): void {
      const cmp = fixture.componentInstance as unknown as {
        onFilePicked: (e: Event, angle: string) => void;
      };
      const input = document.createElement('input');
      Object.defineProperty(input, 'files', { value: [file] });
      cmp.onFilePicked({ target: input } as unknown as Event, angle);
    }

    it('comprime ANTES de subir e sobe o arquivo comprimido', async () => {
      configure({ id: 'insp-1' }, {});
      const fixture = render();
      const original = new File([new Uint8Array(12 * 1024 * 1024)], 'frente.jpg', {
        type: 'image/jpeg',
      });
      const small = new File([new Uint8Array(400 * 1024)], 'frente.jpg', { type: 'image/jpeg' });
      compress.mockResolvedValue(small);

      pick(fixture, original, 'FRONT');
      await flush(fixture);

      expect(compress).toHaveBeenCalledWith(original);
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
      expect(uploadPhoto.mock.calls[0][2]).toBe(small);
      expect(uploadPhoto.mock.calls[0][2]).not.toBe(original);
      // 20s: com a suite inteira rodando em paralelo o render deste caso passava dos 5s padrao.
    }, 20000);

    it('mostra o passo da foto enquanto prepara, antes da rede', async () => {
      configure({ id: 'insp-1' }, {});
      const fixture = render();
      let release: (f: File) => void = () => undefined;
      compress.mockReturnValue(new Promise<File>((resolve) => (release = resolve)));
      const file = new File(['x'], 'f.jpg', { type: 'image/jpeg' });

      pick(fixture, file, 'FRONT');
      fixture.detectChanges();

      expect(text(fixture)).toContain('Preparando');
      expect(uploadPhoto).not.toHaveBeenCalled();

      release(file);
      await flush(fixture);
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });

    it('foto ainda acima de 8 MB apos comprimir NAO sobe e manda fotografar de novo', async () => {
      configure({ id: 'insp-1' }, {});
      const fixture = render();
      const huge = new File([new Uint8Array(9 * 1024 * 1024)], 'frente.heic', {
        type: 'image/heic',
      });
      compress.mockResolvedValue(huge);

      pick(fixture, huge, 'FRONT');
      await flush(fixture);

      expect(uploadPhoto).not.toHaveBeenCalled();
      expect(text(fixture)).toContain('grande demais');
      // Reenviar o MESMO arquivo falharia de novo: nao ha botao de reenviar.
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-retry-upload]'),
      ).toBeNull();
    });

    it('cada foto que falhou tem o PROPRIO reenviar', async () => {
      configure({ id: 'insp-1' }, {});
      const fixture = render();
      uploadPhoto.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

      pick(fixture, new File(['a'], 'a.jpg', { type: 'image/jpeg' }), 'FRONT');
      await flush(fixture);
      pick(fixture, new File(['b'], 'b.jpg', { type: 'image/jpeg' }), 'BACK');
      await flush(fixture);

      const retries = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-retry-upload]',
      );
      expect(retries.length).toBe(2);

      // Reenviar a primeira manda a PRIMEIRA, nao a ultima.
      uploadPhoto.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT'] }));
      (retries[0] as HTMLButtonElement).click();
      fixture.detectChanges();
      const last = uploadPhoto.mock.calls.at(-1) as [string, string, File];
      expect(last[1]).toBe('FRONT');
    });

    /**
     * Alguem enviou ou decidiu a vistoria enquanto esta tela estava aberta: o servidor
     * recusa a foto (so `PENDING` aceita). Reenviar nao adianta — a tela le o estado real.
     */
    it('409: explica, nao oferece reenviar e le o estado real da vistoria', async () => {
      configure({ id: 'insp-1' }, {});
      const fixture = render();
      uploadPhoto.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { message: 'Vistoria não aceita fotos neste estado.', code: 'INSPECTION_NOT_PENDING' },
            }),
        ),
      );
      getOne.mockReturnValue(of({ ...inspection, capturedAngles: [], status: 'SUBMITTED' }));

      pick(fixture, new File(['a'], 'a.jpg', { type: 'image/jpeg' }), 'FRONT');
      await flush(fixture);

      expect(getOne).toHaveBeenCalledWith('insp-1');
      expect(text(fixture)).toContain('aguardam a decisão');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-retry-upload]'),
      ).toBeNull();
    });
  });

  // ============ MOTORISTA: a captura guiada do prototipo ("Motorista Vistorias") ============
  /**
   * O motorista ve UM angulo por tela, depois o hodometro, a revisao e o envio. Por baixo e
   * o mesmo componente: o disparo abre a camera ao vivo e cada foto sobe na hora.
   */
  describe('motorista: captura guiada', () => {
    const el = (fixture: ComponentFixture<InspectionCapture>) =>
      fixture.nativeElement as HTMLElement;
    const q = <T extends Element = HTMLElement>(
      fixture: ComponentFixture<InspectionCapture>,
      selector: string,
    ) => el(fixture).querySelector<T>(selector);

    function open(detail: Partial<Inspection> = {}, query: Record<string, string> = {}) {
      role = 'DRIVER';
      configure({ id: 'insp-1' }, query);
      getOne.mockReturnValue(of({ ...inspection, ...detail }));
      return render();
    }

    function typeKm(fixture: ComponentFixture<InspectionCapture>, value: string): void {
      const input = q<HTMLInputElement>(fixture, '[data-wizard-km]')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('mostra um angulo por tela, comecando pelo primeiro sem foto', () => {
      const fixture = open({ capturedAngles: ['FRONT'] });

      expect(q(fixture, 'app-driver-inspection-wizard')).not.toBeNull();
      expect(q(fixture, '[data-wizard-step]')?.textContent?.trim()).toBe('Foto 2 de 3');
      expect(q(fixture, '[data-wizard-angle]')?.textContent?.trim()).toBe('Traseira');
      expect(q(fixture, '[data-wizard-title]')?.textContent?.trim()).toBe('Vistoria');
      // A grade do dono nao aparece para ele.
      expect(q(fixture, '[data-submit-inspection]')).toBeNull();
    });

    it('o disparo abre a camera ao vivo do angulo da tela', () => {
      const fixture = open();

      q<HTMLButtonElement>(fixture, '[data-shutter]')!.click();
      fixture.detectChanges();

      expect(q(fixture, 'app-live-camera-sheet')).not.toBeNull();
      expect(q(fixture, 'app-live-camera-sheet [role="dialog"]')?.getAttribute('aria-label')).toBe(
        'Frente',
      );
    });

    it('a foto tirada sobe na hora e "Usar foto" leva ao proximo angulo', async () => {
      const fixture = open();
      uploadPhoto.mockReturnValue(of({ ...inspection, capturedAngles: ['FRONT'] }));
      q<HTMLButtonElement>(fixture, '[data-shutter]')!.click();
      fixture.detectChanges();

      fixture.debugElement
        .query((d) => d.name === 'app-live-camera-sheet')
        .triggerEventHandler('captured', new File(['x'], 'f.jpg', { type: 'image/jpeg' }));
      await flush(fixture);

      expect(uploadPhoto).toHaveBeenCalledWith('insp-1', 'FRONT', expect.any(File));
      expect(q(fixture, '[data-use-photo]')).not.toBeNull();
      q<HTMLButtonElement>(fixture, '[data-use-photo]')!.click();
      fixture.detectChanges();
      expect(q(fixture, '[data-wizard-angle]')?.textContent?.trim()).toBe('Traseira');
    });

    it('com todas as fotos, pede o hodometro e recusa valor menor que o ultimo registro', () => {
      const fixture = open({
        capturedAngles: ['FRONT', 'BACK', 'LEFT'],
        previousOdometerKm: 41250,
      });

      expect(q(fixture, '[data-wizard-km]')).not.toBeNull();
      expect(el(fixture).textContent).toContain('41.250');

      q<HTMLButtonElement>(fixture, '[data-wizard-continue]')!.click();
      fixture.detectChanges();
      expect(q(fixture, '[data-wizard-km-error]')?.textContent).toContain(
        'Informe a quilometragem',
      );

      typeKm(fixture, '40000');
      q<HTMLButtonElement>(fixture, '[data-wizard-continue]')!.click();
      fixture.detectChanges();
      expect(q(fixture, '[data-wizard-km-error]')?.textContent).toContain('menor que o último');
      expect(submit).not.toHaveBeenCalled();
    });

    it('a revisao envia pelo MESMO submit, com o hodometro em km inteiros', () => {
      const fixture = open({ capturedAngles: ['FRONT', 'BACK', 'LEFT'], previousOdometerKm: 41250 });

      typeKm(fixture, '42318');
      expect(q<HTMLInputElement>(fixture, '[data-wizard-km]')!.value).toBe('42.318');
      q<HTMLButtonElement>(fixture, '[data-wizard-continue]')!.click();
      fixture.detectChanges();

      expect(el(fixture).querySelectorAll('[data-review-tile]').length).toBe(3);
      expect(q(fixture, '[data-review-km]')?.textContent?.trim()).toBe('42.318 km');
      q<HTMLButtonElement>(fixture, '[data-wizard-send]')!.click();
      fixture.detectChanges();

      expect(submit).toHaveBeenCalledWith('insp-1', { odometerKm: 42318 });
      expect(q(fixture, '[data-wizard-done]')?.textContent).toContain('Vistoria enviada.');
    });

    it('MOTORISTA nao tem galeria — so camera', () => {
      const fixture = open();

      expect(galleryInputs(fixture)).toBe(0);
      expect(q(fixture, '[data-shutter]')?.getAttribute('aria-label')).toBe('Tirar foto: Frente');
    });

    it('403 no envio explica a regra em vez de erro cru', () => {
      const fixture = open({ capturedAngles: ['FRONT', 'BACK', 'LEFT'] });
      submit.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

      typeKm(fixture, '82109');
      q<HTMLButtonElement>(fixture, '[data-wizard-continue]')!.click();
      fixture.detectChanges();
      q<HTMLButtonElement>(fixture, '[data-wizard-send]')!.click();
      fixture.detectChanges();

      expect(text(fixture)).not.toContain('Vistoria enviada.');
      expect(text(fixture).toLowerCase()).toContain('permiss');
      expect(q(fixture, '[data-wizard-send]')).not.toBeNull();
    });

    it('recusada: mostra o motivo e "Refazer vistoria" chama o MESMO recapture', () => {
      const fixture = open({ status: 'REJECTED', rejectionReason: 'Painel tremido.' });

      expect(q(fixture, '[data-wizard-reason]')?.textContent).toContain('Painel tremido.');
      q<HTMLButtonElement>(fixture, '[data-wizard-redo]')!.click();

      expect(recapture).toHaveBeenCalledWith('insp-1');
    });

    it('abrir a recusada (mesmo com ?refazer=1 velho na URL) NAO refaz sozinho', () => {
      const fixture = open({ status: 'REJECTED' }, { refazer: '1' });

      expect(recapture).not.toHaveBeenCalled();
      expect(q(fixture, '[data-wizard-redo]')).not.toBeNull();
    });

    it('sem ?refazer=1 a recusada NAO e refeita sozinha', () => {
      open({ status: 'REJECTED' });

      expect(recapture).not.toHaveBeenCalled();
    });

    it('sair pede confirmacao e o foco fica em continuar', () => {
      const fixture = open({ capturedAngles: ['FRONT'] });

      q<HTMLButtonElement>(fixture, '[data-exit]')!.click();
      fixture.detectChanges();

      expect(q(fixture, '[data-exit-dialog]')?.textContent).toContain('Sua foto já foi enviada');
      expect(document.activeElement).toBe(q(fixture, '[data-exit-stay]'));
      q<HTMLButtonElement>(fixture, '[data-exit-stay]')!.click();
      fixture.detectChanges();
      expect(q(fixture, '[data-exit-dialog]')).toBeNull();
    });

    it('Esc fecha o dialogo de saida com o foco em qualquer lugar, e o foco volta ao X', async () => {
      const fixture = open({ capturedAngles: ['FRONT'] });
      q<HTMLButtonElement>(fixture, '[data-exit]')!.click();
      fixture.detectChanges();
      const section = q(fixture, '[data-wizard]')!.closest('section')!;
      expect(section.hasAttribute('inert')).toBe(true);

      // jsdom does not implement `inert`, so "did the focus land?" is not enough: record
      // whether the X was still inside the inert section WHEN it was focused. A focus call
      // made before change detection (a microtask, in this zoneless app) is lost on a phone.
      const exit = q<HTMLButtonElement>(fixture, '[data-exit]')!;
      const inertAtFocus: boolean[] = [];
      const realFocus = exit.focus.bind(exit);
      exit.focus = (options?: FocusOptions) => {
        inertAtFocus.push(section.hasAttribute('inert'));
        realFocus(options);
      };

      (document.activeElement as HTMLElement | null)?.blur();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      // No detectChanges here: the app's own scheduler decides the order, as in production.
      await fixture.whenStable();

      expect(q(fixture, '[data-exit-dialog]')).toBeNull();
      expect(section.hasAttribute('inert')).toBe(false);
      expect(inertAtFocus).toEqual([false]);
      expect(document.activeElement).toBe(exit);
    });

    it('Tab fica preso no dialogo de saida', () => {
      const fixture = open({ capturedAngles: ['FRONT'] });
      q<HTMLButtonElement>(fixture, '[data-exit]')!.click();
      fixture.detectChanges();
      const leave = q<HTMLButtonElement>(fixture, '[data-exit-leave]')!;
      leave.focus();

      q(fixture, '[data-exit-dialog]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );

      expect(document.activeElement).toBe(q(fixture, '[data-exit-stay]'));
    });

    it('sair avisa que a foto que falhou no envio vai se perder', async () => {
      const fixture = open();
      uploadPhoto.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
      q<HTMLButtonElement>(fixture, '[data-shutter]')!.click();
      fixture.detectChanges();
      fixture.debugElement
        .query((dbg) => dbg.name === 'app-live-camera-sheet')
        .triggerEventHandler('captured', new File(['x'], 'f.jpg', { type: 'image/jpeg' }));
      await flush(fixture);
      expect(q(fixture, '[data-wizard-retry]')).not.toBeNull();

      q<HTMLButtonElement>(fixture, '[data-exit]')!.click();
      fixture.detectChanges();

      expect(q(fixture, '[data-exit-lost]')?.textContent).toContain(
        'A foto de Frente não foi enviada e será perdida se você sair.',
      );
    });

    it('sair com uma foto ainda subindo avisa que ela pode se perder', async () => {
      const fixture = open();
      uploadPhoto.mockReturnValue(new Subject());
      q<HTMLButtonElement>(fixture, '[data-shutter]')!.click();
      fixture.detectChanges();
      fixture.debugElement
        .query((dbg) => dbg.name === 'app-live-camera-sheet')
        .triggerEventHandler('captured', new File(['x'], 'f.jpg', { type: 'image/jpeg' }));
      await flush(fixture);

      q<HTMLButtonElement>(fixture, '[data-exit]')!.click();
      fixture.detectChanges();

      expect(q(fixture, '[data-exit-lost]')?.textContent).toContain(
        'A foto de Frente ainda está sendo enviada e pode se perder se você sair agora.',
      );
    });

    it('colar "42318.5" no hodometro vira 42.318, nao 423.185', () => {
      const fixture = open({ capturedAngles: ['FRONT', 'BACK', 'LEFT'] });
      const input = q<HTMLInputElement>(fixture, '[data-wizard-km]')!;
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: { getData: () => '42318.5' },
      });

      input.dispatchEvent(paste);
      fixture.detectChanges();

      expect(paste.defaultPrevented).toBe(true);
      expect(input.value).toBe('42.318');
    });

    it('o dono continua com a grade de sempre', () => {
      role = 'OWNER';
      configure({ id: 'insp-1' }, {});
      const fixture = render();

      expect(q(fixture, 'app-driver-inspection-wizard')).toBeNull();
      expect(text(fixture)).toContain('0 de 3 fotos');
    });
  });
});
