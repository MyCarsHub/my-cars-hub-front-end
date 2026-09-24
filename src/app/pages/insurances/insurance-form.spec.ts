import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, afterEach, vi } from 'vitest';

import { InsuranceForm } from './insurance-form';
import { InsurancesService } from '../../services/insurances.service';
import { NotificationService } from '../../services/notification.service';
import { ApiErrorService } from '../../services/api-error.service';

/**
 * FIX-0261 — o prêmio da apólice deixou de ser `input type="number"` e passou a
 * ser texto pt-BR com máscara de milhar.
 *
 * A tela de apólice é SÓ edição, então ela é o lugar natural para provar a
 * semeadura: 240.050 centavos têm de chegar ao campo já como "2.400,50", e o
 * PATCH tem de devolver exatamente os mesmos 240.050 — um campo que mostra
 * certo e envia outra coisa é pior que um campo feio.
 */
describe('InsuranceForm — prêmio com máscara de milhar (FIX-0261)', () => {
  let update: ReturnType<typeof vi.fn>;
  let fixture: ReturnType<typeof TestBed.createComponent<InsuranceForm>>;

  const POLICY = {
    id: 'ins-1',
    vehicleId: 'veh-1',
    insurer: 'Porto Seguro',
    policyNumber: 'AP-99887',
    coverageType: 'COMPREHENSIVE',
    premiumAmount: 240_050,
    deductibleAmount: 300_000,
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    paymentMethod: 'CREDIT_CARD',
    notes: null,
    status: 'ACTIVE',
  };

  function api(): { submit: () => void } {
    return fixture.componentInstance as unknown as { submit: () => void };
  }

  function premiumInput(): HTMLInputElement {
    const input = fixture.nativeElement.querySelector(
      '#seguro-premium-amount',
    ) as HTMLInputElement | null;
    if (!input) throw new Error('campo de premio nao esta na tela');
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

  async function setup(policy: Record<string, unknown> = POLICY): Promise<void> {
    TestBed.resetTestingModule();
    update = vi.fn().mockReturnValue(of({ id: 'ins-1' }));

    await TestBed.configureTestingModule({
      imports: [InsuranceForm],
      providers: [
        provideRouter([]),
        ApiErrorService,
        {
          provide: InsurancesService,
          useValue: { getOne: vi.fn().mockReturnValue(of(policy)), update },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'ins-1' } } },
        },
        {
          provide: NotificationService,
          useValue: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(InsuranceForm);
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('semeia a edicao ja formatada: 240.050 centavos viram "2.400,50" no campo', async () => {
    await setup();

    const input = premiumInput();
    expect(input.type).toBe('text');
    expect(input.inputMode).toBe('decimal');
    expect(input.value).toBe('2.400,50');
  });

  it('salvar sem tocar no campo devolve os MESMOS centavos ao PATCH', async () => {
    await setup();

    api().submit();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][2]).toMatchObject({ premiumAmount: 240_050 });
  });

  it('digitacao incremental mostra o milhar e o PATCH leva os centavos novos', async () => {
    await setup();

    const input = premiumInput();
    input.value = '';
    input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward' }));
    fixture.detectChanges();

    const frames = type(input, '31500');
    expect(frames).toEqual(['3', '31', '315', '3.150', '31.500']);
    type(input, ',25');
    expect(input.value).toBe('31.500,25');

    api().submit();
    expect(update.mock.calls[0][2]).toMatchObject({ premiumAmount: 3_150_025 });
  });
});
