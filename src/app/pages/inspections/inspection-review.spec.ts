import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InspectionReview } from './inspection-review';
import { InspectionsService } from '../../services/inspections.service';
import { SessionService } from '../../services/session.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { InspectionPhoto, InspectionReviewResult } from '../../types/inspection.types';

/**
 * A DECISAO sobre uma vistoria enviada: aprovar ou recusar.
 *
 * E a aprovacao — nao o envio — que fecha a ocorrencia do ciclo. Enquanto
 * ninguem aprovava, NENHUMA vistoria chegava a `COMPLETED` e o lembrete do
 * motor nunca parava, para papel nenhum.
 *
 * Os invariantes, em ordem de risco:
 *
 * 1. NAO SE APROVA SEM VER. Sem as fotos na tela nao ha botao de aprovar —
 *    aprovar as cegas e assinar em branco. Lista vazia ou falha viram "tentar
 *    de novo", nunca um aprovar habilitado.
 * 2. RECUSA EXIGE MOTIVO na tela, nao so no servidor. Quem refotografa precisa
 *    saber o que estava errado; um 400 do backend chegaria tarde e sem rumo.
 * 3. O MOTORISTA NAO DECIDE. O servidor ja barra; aqui e defesa em
 *    profundidade, para a tela nao oferecer o que sera recusado.
 * 4. A URL ASSINADA EXPIRA. Imagem quebrada nao e estado final: a tela
 *    RECARREGA a lista em vez de exibir o icone de imagem morta.
 * 5. FALHAR NAO E DECIDIR. Se aprovar ou recusar falhar, a tela nao pode
 *    afirmar que decidiu.
 */
describe('InspectionReview', () => {
  /**
   * A forma EXATA de `GET /v1/inspections/{id}/photos` — os sete campos do DTO
   * real, nao os dois que a tela consome. Duble que so traz o que o componente
   * usa deixa de pegar o dia em que o componente passar a usar outro.
   *
   * `storagePath` NAO aparece porque o servidor nao o manda: e caminho de
   * objeto no bucket. Um duble que o inventasse convidaria alguem a usa-lo.
   */
  const PHOTOS: InspectionPhoto[] = [
    {
      id: 'ph-1',
      inspectionId: 'insp-1',
      angle: 'FRONT',
      mimeType: 'image/jpeg',
      sizeBytes: 182_344,
      signedUrl: 'https://cdn.example/f.jpg?sig=1',
      createdDate: '2026-10-01T10:00:00',
    },
    {
      id: 'ph-2',
      inspectionId: 'insp-1',
      angle: 'BACK',
      mimeType: 'image/jpeg',
      sizeBytes: 201_118,
      signedUrl: 'https://cdn.example/b.jpg?sig=2',
      createdDate: '2026-10-01T10:04:00',
    },
  ];

  /** A forma EXATA de `approve` / `reject` — campo a campo com o backend. */
  const APPROVED: InspectionReviewResult = {
    id: 'insp-1',
    status: 'APPROVED',
    scheduleId: 'sch-1',
    dueAt: '2026-10-01T00:00:00',
    pdfDocumentId: null,
    supersedesId: null,
  };
  const REJECTED: InspectionReviewResult = { ...APPROVED, status: 'REJECTED' };

  let photos: ReturnType<typeof vi.fn>;
  let approve: ReturnType<typeof vi.fn>;
  let reject: ReturnType<typeof vi.fn>;
  let role: string;

  function configure(): void {
    TestBed.resetTestingModule();
    photos = vi.fn().mockReturnValue(of(PHOTOS));
    approve = vi.fn().mockReturnValue(of(APPROVED));
    reject = vi.fn().mockReturnValue(of(REJECTED));

    TestBed.configureTestingModule({
      imports: [InspectionReview],
      providers: [
        ApiErrorService,
        { provide: InspectionsService, useValue: { photos, approve, reject } },
        { provide: SessionService, useValue: { getCompanyRoleFromToken: () => role } },
      ],
    });
  }

  function render(): ComponentFixture<InspectionReview> {
    const fixture = TestBed.createComponent(InspectionReview);
    fixture.componentRef.setInput('inspectionId', 'insp-1');
    fixture.detectChanges();
    return fixture;
  }

  const host = (f: ComponentFixture<InspectionReview>) => f.nativeElement as HTMLElement;
  const text = (f: ComponentFixture<InspectionReview>) =>
    (host(f).textContent ?? '').replace(/\s+/g, ' ');
  const approveBtn = (f: ComponentFixture<InspectionReview>) =>
    host(f).querySelector<HTMLButtonElement>('[data-approve]');
  const rejectBtn = (f: ComponentFixture<InspectionReview>) =>
    host(f).querySelector<HTMLButtonElement>('[data-reject]');
  const reasonInput = (f: ComponentFixture<InspectionReview>) =>
    host(f).querySelector<HTMLTextAreaElement>('[data-reject-reason]');
  const images = (f: ComponentFixture<InspectionReview>) =>
    Array.from(host(f).querySelectorAll('img'));

  function typeReason(f: ComponentFixture<InspectionReview>, value: string): void {
    const field = reasonInput(f);
    if (!field) throw new Error('campo de motivo não renderizado');
    field.value = value;
    field.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  beforeEach(() => {
    role = 'OWNER';
  });

  it('busca as fotos da vistoria ao abrir', () => {
    configure();
    render();

    expect(photos).toHaveBeenCalledWith('insp-1');
  });

  it('mostra cada foto COM o rotulo do angulo', () => {
    configure();
    const fixture = render();

    expect(images(fixture).length).toBe(2);
    // Ordem canonica do roteiro: `FRONT` antes de `BACK`.
    expect(images(fixture)[0].getAttribute('src')).toBe(PHOTOS[0].signedUrl);
    // O rotulo e do contrato (`angle`), nao da ordem, e vem EM PORTUGUES do
    // mesmo `angleLabel` da captura: o mesmo angulo nao pode ter dois nomes, e
    // quem fotografa na rua nao traduz nada para achar o lado do carro.
    expect(text(fixture)).toContain('Frente');
    expect(text(fixture)).toContain('Traseira');
  });

  describe('invariante 1 — nao se aprova sem ver', () => {
    it('sem fotos carregadas ainda, nao oferece aprovar', () => {
      configure();
      photos.mockReturnValue(new Subject<InspectionPhoto[]>());
      const fixture = render();

      expect(approveBtn(fixture)).toBeNull();
    });

    it('lista de fotos VAZIA nao oferece aprovar — oferece tentar de novo', () => {
      configure();
      photos.mockReturnValue(of([]));
      const fixture = render();

      expect(approveBtn(fixture)).toBeNull();
      expect(host(fixture).querySelector('[data-retry-photos]')).not.toBeNull();
    });

    it('FALHA ao buscar fotos nao oferece aprovar — oferece tentar de novo', () => {
      configure();
      photos.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const fixture = render();

      expect(approveBtn(fixture)).toBeNull();
      expect(host(fixture).querySelector('[data-retry-photos]')).not.toBeNull();
      expect(approve).not.toHaveBeenCalled();
    });

    it('o retry busca as fotos de novo', () => {
      configure();
      photos.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      const fixture = render();

      photos.mockReturnValue(of(PHOTOS));
      host(fixture).querySelector<HTMLButtonElement>('[data-retry-photos]')?.click();
      fixture.detectChanges();

      expect(photos).toHaveBeenCalledTimes(2);
      expect(approveBtn(fixture)).not.toBeNull();
    });
  });

  describe('invariante 2 — recusa exige motivo', () => {
    it('motivo vazio NAO envia', () => {
      configure();
      const fixture = render();

      rejectBtn(fixture)?.click();
      fixture.detectChanges();

      expect(reject).not.toHaveBeenCalled();
      expect(text(fixture)).toContain('motivo');
    });

    it('so espacos tambem nao envia', () => {
      configure();
      const fixture = render();
      typeReason(fixture, '    ');

      rejectBtn(fixture)?.click();
      fixture.detectChanges();

      expect(reject).not.toHaveBeenCalled();
    });

    it('com motivo, recusa e manda o texto', () => {
      configure();
      const fixture = render();
      typeReason(fixture, 'A foto da frente está escura.');

      rejectBtn(fixture)?.click();
      fixture.detectChanges();

      expect(reject).toHaveBeenCalledWith('insp-1', 'A foto da frente está escura.');
    });
  });

  describe('invariante 3 — o motorista nao decide', () => {
    it('MOTORISTA nao recebe aprovar nem recusar', () => {
      configure();
      role = 'DRIVER';
      const fixture = render();

      expect(approveBtn(fixture)).toBeNull();
      expect(rejectBtn(fixture)).toBeNull();
    });

    it('MOTORISTA ainda VE as fotos — o que ele nao tem e a decisao', () => {
      configure();
      role = 'DRIVER';
      const fixture = render();

      expect(images(fixture).length).toBe(2);
    });

    it('OWNER e MANAGER decidem', () => {
      for (const papel of ['OWNER', 'MANAGER']) {
        configure();
        role = papel;
        const fixture = render();

        expect(approveBtn(fixture), `${papel} sem aprovar`).not.toBeNull();
        expect(rejectBtn(fixture), `${papel} sem recusar`).not.toBeNull();
      }
    });
  });

  describe('invariante 4 — a URL assinada expira', () => {
    it('imagem que falha recarrega a LISTA em vez de ficar quebrada', () => {
      configure();
      const fixture = render();

      images(fixture)[0].dispatchEvent(new Event('error'));
      fixture.detectChanges();

      expect(photos).toHaveBeenCalledTimes(2);
    });

    it('nao entra em laco: recarrega uma vez, depois explica', () => {
      configure();
      const fixture = render();

      images(fixture)[0].dispatchEvent(new Event('error'));
      fixture.detectChanges();
      images(fixture)[0].dispatchEvent(new Event('error'));
      fixture.detectChanges();

      expect(photos).toHaveBeenCalledTimes(2);
      expect(text(fixture).toLowerCase()).toContain('expir');
    });
  });

  describe('invariante 5 — falhar nao e decidir', () => {
    it('aprovar com sucesso confirma e encerra a decisao', () => {
      configure();
      const fixture = render();

      approveBtn(fixture)?.click();
      fixture.detectChanges();

      expect(approve).toHaveBeenCalledWith('insp-1');
      expect(text(fixture)).toContain('aprovada');
      expect(approveBtn(fixture)).toBeNull();
    });

    it('aprovar que FALHA nao diz que aprovou, e deixa tentar de novo', () => {
      configure();
      const fixture = render();
      approve.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      approveBtn(fixture)?.click();
      fixture.detectChanges();

      expect(text(fixture)).not.toContain('aprovada');
      expect(approveBtn(fixture)).not.toBeNull();
    });

    it('recusar que FALHA nao diz que recusou, e preserva o motivo digitado', () => {
      configure();
      const fixture = render();
      reject.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      typeReason(fixture, 'Faltou a lateral direita.');

      rejectBtn(fixture)?.click();
      fixture.detectChanges();

      expect(text(fixture)).not.toContain('recusada');
      // Perder o texto obrigaria a pessoa a redigitar o motivo depois de falhar.
      expect(reasonInput(fixture)?.value).toBe('Faltou a lateral direita.');
    });

    it('enquanto decide, nao decide duas vezes', () => {
      configure();
      const fixture = render();
      approve.mockReturnValue(new Subject<InspectionReviewResult>());

      approveBtn(fixture)?.click();
      fixture.detectChanges();
      approveBtn(fixture)?.click();
      fixture.detectChanges();

      expect(approve).toHaveBeenCalledTimes(1);
    });
  });

  it('emite a decisao para quem hospeda, para a lista se atualizar', () => {
    configure();
    const fixture = render();
    const decided: InspectionReviewResult[] = [];
    fixture.componentInstance.decided.subscribe((r) => decided.push(r));

    approveBtn(fixture)?.click();
    fixture.detectChanges();

    expect(decided).toEqual([APPROVED]);
  });
  /**
   * A ORDEM e do ROTEIRO, e `id` identifica. Nenhum dos dois e cosmetico:
   * ordem imprevisivel obriga quem aprova a ler rotulo por rotulo para saber
   * onde esta, e chave instavel remonta a galeria inteira a cada recarga.
   */
  describe('ordem e identidade das fotos', () => {
    const labelsOf = (f: ComponentFixture<InspectionReview>) =>
      Array.from(host(f).querySelectorAll('[data-angle-label]')).map((p) =>
        (p.textContent ?? '').trim(),
      );

    it('mostra na ordem CANONICA do roteiro, qualquer que seja a ordem do servidor', () => {
      configure();
      // Servidor devolve invertido de proposito: ordem de resposta NAO e
      // contrato, e a tela nao pode depender dela.
      photos.mockReturnValue(of([PHOTOS[1], PHOTOS[0]]));
      const fixture = render();

      expect(labelsOf(fixture)).toEqual(['Frente', 'Traseira']);
    });

    /**
     * NAO ordena por data: dentro de uma vistoria ha uma foto por angulo, entao
     * a data so embaralharia o roteiro. Aqui a mais RECENTE e a `FRONT`, e ela
     * continua em primeiro por ser a primeira do roteiro — nao por ser recente.
     */
    it('a data nao decide a ordem', () => {
      configure();
      photos.mockReturnValue(
        of([
          { ...PHOTOS[0], createdDate: '2026-10-01T23:59:00' },
          { ...PHOTOS[1], createdDate: '2026-10-01T00:01:00' },
        ]),
      );
      const fixture = render();

      expect(labelsOf(fixture)).toEqual(['Frente', 'Traseira']);
    });

    /** Roteiro e configuravel por empresa: chave fora da lista vai para o FIM. */
    it('angulo desconhecido fica depois dos do roteiro, sem se intercalar', () => {
      configure();
      photos.mockReturnValue(
        of([
          { ...PHOTOS[0], id: 'ph-x', angle: 'TETO_SOLAR', createdDate: '2026-10-01T09:00:00' },
          PHOTOS[1],
          PHOTOS[0],
        ]),
      );
      const fixture = render();

      expect(labelsOf(fixture)).toEqual(['Frente', 'Traseira', 'Teto solar']);
    });

    it('a chave da lista NAO e a signedUrl: reassinar nao recria a galeria', () => {
      configure();
      const fixture = render();
      const before = images(fixture)[0];

      // Mesma foto (mesmo `id`), URL reassinada — o que acontece a cada recarga.
      photos.mockReturnValue(
        of(PHOTOS.map((p) => ({ ...p, signedUrl: `${p.signedUrl}&again=1` }))),
      );
      host(fixture).querySelector<HTMLButtonElement>('[data-retry-photos]')?.click();
      fixture.detectChanges();

      // O elemento e o MESMO no DOM; so o src mudou. Com `track signedUrl` o
      // Angular teria destruido e recriado as 14 imagens.
      expect(images(fixture)[0]).toBe(before);
    });
  });
  /**
   * FALHA PARCIAL — e esta que vai acontecer de verdade.
   *
   * O backend isola a assinatura por foto: antes, UMA que falhasse derrubava a
   * resposta inteira e a tela mostrava zero em vez de 13 de 14. Agora o item
   * vem com `signedUrl` nulo e NAO e omitido, porque omitir faria a lista
   * parecer completa.
   *
   * O teste de falha que ja existia era a lista INTEIRA caindo. Este e o outro,
   * e e o comum.
   */
  describe('foto indisponivel (signedUrl nulo)', () => {
    const partial = () => [PHOTOS[0], { ...PHOTOS[1], signedUrl: null }];

    it('NAO oferece aprovar com qualquer foto indisponivel — ver 13 de 14 nao e ver', () => {
      configure();
      photos.mockReturnValue(of(partial()));
      const fixture = render();

      expect(approveBtn(fixture)).toBeNull();
    });

    it('diz QUAL angulo nao carregou', () => {
      configure();
      photos.mockReturnValue(of(partial()));
      const fixture = render();

      expect(text(fixture)).toContain('Traseira');
      expect(text(fixture)).toContain('não carregou');
    });

    it('o item NAO some da lista: 2 angulos continuam listados', () => {
      configure();
      photos.mockReturnValue(of(partial()));
      const fixture = render();

      const labels = Array.from(host(fixture).querySelectorAll('[data-angle-label]'));
      expect(labels.length).toBe(2);
      // Sem img quebrada: o lugar existe, com explicacao no lugar da imagem.
      expect(images(fixture).length).toBe(1);
    });

    /**
     * A copia distingue "nao carregou" de "nao tem foto", e a distincao e o que
     * impede recusar pelo motivo errado — mandar refotografar o que ja esta
     * salvo seria punir o motorista por uma falha nossa.
     */
    it('diz que a foto esta SALVA, nao que falta', () => {
      configure();
      photos.mockReturnValue(of(partial()));
      const fixture = render();

      expect(text(fixture)).toContain('está salva');
    });

    it('oferece tentar de novo', () => {
      configure();
      photos.mockReturnValue(of(partial()));
      const fixture = render();

      expect(host(fixture).querySelector('[data-retry-photos]')).not.toBeNull();
    });

    /** Assimetria deliberada: recusar aponta problema, aprovar afirma que esta tudo certo. */
    it('RECUSAR continua disponivel, com motivo', () => {
      configure();
      photos.mockReturnValue(of(partial()));
      const fixture = render();
      typeReason(fixture, 'A frente está fora de foco.');

      rejectBtn(fixture)?.click();
      fixture.detectChanges();

      expect(reject).toHaveBeenCalledWith('insp-1', 'A frente está fora de foco.');
    });

    it('assinando de novo com sucesso, aprovar volta', () => {
      configure();
      photos.mockReturnValue(of(partial()));
      const fixture = render();
      expect(approveBtn(fixture)).toBeNull();

      photos.mockReturnValue(of(PHOTOS));
      host(fixture).querySelector<HTMLButtonElement>('[data-retry-photos]')?.click();
      fixture.detectChanges();

      expect(approveBtn(fixture)).not.toBeNull();
    });
  });
  /**
   * QUANDO cada foto foi tirada.
   *
   * Numa vistoria PERIODICA, foto de hoje e foto de tres semanas atras sao
   * indistinguiveis para quem aprova. Sem a data o dono aprova como ATUAL um
   * estado que pode nao ser mais verdade — e medir o estado atual e a razao de
   * a vistoria periodica existir.
   */
  describe('data de cada foto', () => {
    const dates = (f: ComponentFixture<InspectionReview>) =>
      Array.from(host(f).querySelectorAll('[data-taken-at]')).map((p) =>
        (p.textContent ?? '').trim(),
      );

    it('mostra a data de CADA foto, uma por foto', () => {
      configure();
      const fixture = render();

      expect(dates(fixture).length).toBe(2);
      expect(dates(fixture)[0]).toContain('01/10/2026');
    });

    /** O caso que motivou: uma foto velha no meio de uma vistoria de hoje. */
    it('uma foto de semanas atras aparece com a data dela, nao com a das outras', () => {
      configure();
      photos.mockReturnValue(
        of([PHOTOS[0], { ...PHOTOS[1], createdDate: '2026-09-10T08:30:00' }]),
      );
      const fixture = render();

      expect(dates(fixture)[0]).toContain('01/10/2026');
      expect(dates(fixture)[1]).toContain('10/09/2026');
    });

    it('a foto indisponivel tambem mostra quando foi tirada', () => {
      configure();
      photos.mockReturnValue(of([PHOTOS[0], { ...PHOTOS[1], signedUrl: null }]));
      const fixture = render();

      expect(dates(fixture).length).toBe(2);
    });
  });
  /**
   * PARIDADE COM O CARD DE FOTOS DO ALUGUEL
   * (`pages/rentals/documents/rental-inspection-card`).
   *
   * A referencia e aquele card e NAO `vehicles-list`: esta tela julga FOTO POR
   * FOTO, como a do aluguel. Padrao de lista serve a lista.
   *
   * Sem estas asercoes a convergencia e invisivel para a suite — e volta a
   * divergir na proxima edicao de qualquer um dos dois lados, que foi
   * exatamente como as duas telas acabaram diferentes.
   */
  describe('paridade com o card de fotos do aluguel', () => {
    it('usa o MESMO involucro: app-page-card', () => {
      configure();
      const fixture = render();

      expect(host(fixture).querySelector('app-page-card')).not.toBeNull();
    });

    it('a grade e 2 colunas no celular, 3 no sm, 4 no lg', () => {
      configure();
      const fixture = render();
      const grid = host(fixture).querySelector('ul');

      expect(grid?.className).toContain('grid-cols-2');
      expect(grid?.className).toContain('sm:grid-cols-3');
      expect(grid?.className).toContain('lg:grid-cols-4');
    });

    /**
     * QUADRO QUADRADO, e a imagem preenchendo em absoluto — nao `h-40` no
     * `<img>`. Altura fixa recorta diferente conforme a largura da coluna;
     * `aspect-square` mantem o enquadramento igual em qualquer tela, e e isso
     * que deixa comparar dois angulos sem um parecer esticado.
     */
    it('cada foto vive num quadro QUADRADO, preenchido em absoluto', () => {
      configure();
      const fixture = render();
      const tiles = host(fixture).querySelectorAll('li .aspect-square');

      expect(tiles.length).toBe(2);
      for (const img of images(fixture)) {
        expect(img.className).toContain('absolute');
        expect(img.className).toContain('object-cover');
        expect(img.className, 'altura fixa voltou e o enquadramento varia por coluna')
          .not.toContain('h-40');
      }
    });

    /** O lugar da foto que nao assinou tambem e quadrado: a grade nao deforma. */
    it('a foto indisponivel ocupa o mesmo quadro quadrado', () => {
      configure();
      photos.mockReturnValue(of([PHOTOS[0], { ...PHOTOS[1], signedUrl: null }]));
      const fixture = render();

      expect(host(fixture).querySelectorAll('li .aspect-square').length).toBe(2);
      expect(host(fixture).textContent).toContain('está salva');
    });
  });
});
