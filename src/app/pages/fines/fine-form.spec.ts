import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { FineForm } from './fine-form';
import { FinesService } from '../../services/fines.service';
import { VehiclesService } from '../../services/vehicles.service';
import { DriverService } from '../../services/driver.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';

/**
 * Feedback standard (phase 3): backend `fieldErrors` land inline under the field,
 * are not repeated in the banner, and never fire a toast.
 */
describe('FineForm — erros de campo vindos do backend', () => {
  let create: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<FineForm>>;

  const emptyPage = { content: [], page: 0, size: 20, total: 0 };

  function descriptionError(): HTMLElement | null {
    return fixture.nativeElement.querySelector('#fine-desc-error');
  }

  function fillValidForm(): void {
    const form = (
      fixture.componentInstance as unknown as { form: { patchValue: (v: unknown) => void } }
    ).form;
    form.patchValue({
      vehicleId: 'veh-1',
      description: 'Excesso de velocidade',
      infractionDate: '2026-05-01T10:00',
      amountReais: '195,23',
      severity: 'MEDIA',
      status: 'PENDING',
    });
  }

  function submit(): void {
    (fixture.componentInstance as unknown as { submit: () => void }).submit();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    create = vi.fn();
    notifyError = vi.fn();

    await TestBed.configureTestingModule({
      imports: [FineForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        { provide: FinesService, useValue: { getOne: vi.fn(), create, update: vi.fn() } },
        { provide: VehiclesService, useValue: { list: vi.fn().mockReturnValue(of(emptyPage)) } },
        { provide: DriverService, useValue: { list: vi.fn().mockReturnValue(of(emptyPage)) } },
        {
          provide: NotificationService,
          useValue: { error: notifyError, warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FineForm);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra o fieldError da descrição embaixo do campo, sem banner e sem toast', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        message: 'Descrição inválida.',
        fieldErrors: { description: 'Descrição inválida.' },
      },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    const inline = descriptionError();
    expect(inline).not.toBeNull();
    expect(inline?.textContent?.trim()).toBe('Descrição inválida.');
    expect(inline?.getAttribute('role')).toBe('alert');
    expect(fixture.nativeElement.querySelector('app-alert-banner')).toBeNull();

    TestBed.inject(ApiErrorService).scheduleSafetyNet(error);
    vi.runAllTimers();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('mostra erro de negócio sem campo no banner do formulário', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { message: 'Multa já registrada para esta infração.' },
    });
    create.mockReturnValue(throwError(() => error));

    fillValidForm();
    submit();

    expect(fixture.nativeElement.innerHTML).toContain('Multa já registrada para esta infração.');
    expect(descriptionError()).toBeNull();
    expect(notifyError).not.toHaveBeenCalled();
  });
});

/**
 * FIX-0261 — o valor da multa deixou de ser `input type="number"` e passou a
 * ser texto pt-BR com máscara de milhar.
 *
 * Os três elos: a tecla escreve o agrupamento, o submit emite CENTAVOS (o
 * contrato da API não mudou) e a edição semeia o campo já formatado.
 */
describe('FineForm — valor com máscara de milhar (FIX-0261)', () => {
  let create: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<FineForm>>;

  const emptyPage = { content: [], totalElements: 0, totalPages: 0, number: 0, size: 0 };

  const FINE = {
    id: 'fine-1',
    vehicleId: 'veh-1',
    driverId: null,
    infractionCode: null,
    description: 'Excesso de velocidade',
    infractionDate: '2026-05-01T10:00:00',
    location: null,
    amountCents: 195_723,
    points: 4,
    severity: 'MEDIA',
    dueDate: null,
    status: 'PENDING',
    paidDate: null,
    notes: null,
  };

  function api(): { form: { patchValue: (v: unknown) => void }; submit: () => void } {
    return fixture.componentInstance as unknown as {
      form: { patchValue: (v: unknown) => void };
      submit: () => void;
    };
  }

  function amountInput(): HTMLInputElement {
    const input = fixture.nativeElement.querySelector('#fine-amount') as HTMLInputElement | null;
    if (!input) throw new Error('campo de valor nao esta na tela');
    return input;
  }

  /** Tecla a tecla, como o teclado faz: `insertText` + caret no fim. */
  function type(input: HTMLInputElement, keys: string): string[] {
    const frames: string[] = [];
    for (const key of keys) {
      input.value = input.value + key;
      input.setSelectionRange(input.value.length, input.value.length);
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: key }));
      fixture.detectChanges();
      frames.push(input.value);
    }
    return frames;
  }

  async function setup(routeId: string | null): Promise<void> {
    TestBed.resetTestingModule();
    create = vi.fn().mockReturnValue(of({ id: 'fine-nova' }));
    update = vi.fn().mockReturnValue(of({ id: 'fine-1' }));

    await TestBed.configureTestingModule({
      imports: [FineForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => routeId } } },
        },
        {
          provide: FinesService,
          useValue: { getOne: vi.fn().mockReturnValue(of(FINE)), create, update },
        },
        { provide: VehiclesService, useValue: { list: vi.fn().mockReturnValue(of(emptyPage)) } },
        { provide: DriverService, useValue: { list: vi.fn().mockReturnValue(of(emptyPage)) } },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(FineForm);
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('digitacao incremental mostra o milhar e o POST leva os centavos', async () => {
    await setup(null);

    const input = amountInput();
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');

    const frames = type(input, '19572');
    expect(frames).toEqual(['1', '19', '195', '1.957', '19.572']);
    type(input, ',30');
    expect(input.value).toBe('19.572,30');

    api().form.patchValue({
      vehicleId: 'veh-1',
      description: 'Excesso de velocidade',
      infractionDate: '2026-05-01T10:00',
      severity: 'MEDIA',
      status: 'PENDING',
    });
    api().submit();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ amountCents: 1_957_230 });
  });

  it('edicao: semeia o campo ja formatado e o PUT devolve os MESMOS centavos', async () => {
    await setup('fine-1');

    expect(amountInput().value).toBe('1.957,23');

    api().submit();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toMatchObject({ amountCents: 195_723 });
  });

  it('campo vazio nao vira zero: o form recusa antes do POST', async () => {
    await setup(null);

    api().form.patchValue({
      vehicleId: 'veh-1',
      description: 'Excesso de velocidade',
      infractionDate: '2026-05-01T10:00',
      severity: 'MEDIA',
      status: 'PENDING',
    });
    api().submit();

    expect(create).not.toHaveBeenCalled();
  });
});
