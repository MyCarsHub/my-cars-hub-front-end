import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { InspectionCapture } from './inspection-capture';
import { InspectionsService } from '../../services/inspections.service';
import { SessionService } from '../../services/session.service';
import { ApiErrorService } from '../../services/api-error.service';
import type { Inspection } from '../../types/inspection.types';

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
    requiredAngles: ['FRONT', 'REAR', 'LEFT_SIDE'],
    capturedAngles: [],
  };

  let create: ReturnType<typeof vi.fn>;
  let getOne: ReturnType<typeof vi.fn>;
  let uploadPhoto: ReturnType<typeof vi.fn>;
  let role: string;

  function configure(params: Record<string, string>, query: Record<string, string>): void {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of(inspection));
    getOne = vi.fn().mockReturnValue(of(inspection));
    uploadPhoto = vi.fn().mockReturnValue(of(inspection));

    TestBed.configureTestingModule({
      imports: [InspectionCapture],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: InspectionsService, useValue: { create, getOne, uploadPhoto } },
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
    expect(body).toContain('Front');
    expect(body).toContain('Rear');
    expect(body).toContain('Left side');
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
    expect(text(fixture)).toContain('Fotografar: Rear');
  });

  it('com todos os angulos fotografados mostra o estado de concluida', () => {
    configure({ id: 'insp-1' }, {});
    getOne.mockReturnValue(
      of({ ...inspection, capturedAngles: ['FRONT', 'REAR', 'LEFT_SIDE'] }),
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
    cmp.onFilePicked({ target: input } as unknown as Event, 'REAR');
    fixture.detectChanges();

    // O progresso conquistado continua na tela.
    expect(text(fixture)).toContain('1 de 3 fotos');
    expect(text(fixture)).toContain('Não foi possível enviar esta foto');
  });

  it('a foto sobe no angulo escolhido e a tela adota o que o servidor devolve', () => {
    configure({ id: 'insp-1' }, {});
    const fixture = render();

    uploadPhoto.mockReturnValue(of({ ...inspection, capturedAngles: ['REAR'] }));
    const cmp = fixture.componentInstance as unknown as {
      onFilePicked: (e: Event, angle: string) => void;
    };
    const file = new File(['x'], 'f.jpg', { type: 'image/jpeg' });
    const input = document.createElement('input');
    Object.defineProperty(input, 'files', { value: [file] });
    cmp.onFilePicked({ target: input } as unknown as Event, 'REAR');
    fixture.detectChanges();

    expect(uploadPhoto).toHaveBeenCalledWith('insp-1', 'REAR', file);
    expect(text(fixture)).toContain('1 de 3 fotos');
  });
});
