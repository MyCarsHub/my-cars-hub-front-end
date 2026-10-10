import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';

import { PaywallDialog } from './paywall-dialog';
import type { BlockReason } from '../../types/billing-access.types';

/**
 * The paywall speaks to two audiences: the OWNER, who can open `/billing`, and everyone
 * else, who cannot and must be told who can. The copy is the contract, so it is asserted on
 * the rendered DOM, per role and per block reason.
 */
describe('PaywallDialog — texto por papel', () => {
  const REASONS: BlockReason[] = [
    'TRIAL_EXPIRED',
    'PAYMENT_FAILED',
    'PAST_DUE',
    'CANCELED',
    'NO_SUBSCRIPTION',
  ];

  let fixture: ComponentFixture<PaywallDialog>;

  function render(reason: BlockReason | null, canRegularize?: boolean): HTMLElement {
    fixture = TestBed.createComponent(PaywallDialog);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('reason', reason);
    if (canRegularize !== undefined) fixture.componentRef.setInput('canRegularize', canRegularize);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const title = (el: HTMLElement): string =>
    el.querySelector('#paywall-title')?.textContent?.trim() ?? '';
  const body = (el: HTMLElement): string =>
    el.querySelector('#paywall-body')?.textContent?.trim() ?? '';
  const cta = (el: HTMLElement): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('[data-paywall-cta]');

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PaywallDialog],
      providers: [provideNoopAnimations()],
    });
  });

  it('dono: mantem o texto e o CTA de cada motivo', () => {
    const trial = render('TRIAL_EXPIRED', true);
    expect(title(trial)).toBe('Seu período de teste terminou');
    expect(body(trial)).toBe('Assine o PRO para continuar usando o MyCarsHub.');
    expect(cta(trial)?.textContent?.trim()).toBe('Ver planos');

    const pending = render('PAST_DUE', true);
    expect(title(pending)).toBe('Pagamento pendente');
    expect(cta(pending)?.textContent?.trim()).toBe('Ver planos');

    const none = render('NO_SUBSCRIPTION', true);
    expect(title(none)).toBe('Escolha um plano para começar');
    expect(cta(none)?.textContent?.trim()).toBe('Ver planos');
  });

  it('sem informar o papel, o dialogo e o do dono (nenhum chamador antigo muda)', () => {
    const el = render('CANCELED');
    expect(title(el)).toBe('Sua assinatura foi cancelada');
    expect(cta(el)?.textContent?.trim()).toBe('Ver planos');
  });

  it('quem nao e dono: diz que so o dono regulariza, para QUALQUER motivo, sem mandar assinar', () => {
    for (const reason of [...REASONS, null]) {
      const el = render(reason, false);
      expect(title(el), String(reason)).toBe('Esta empresa está sem plano ativo');
      expect(body(el), String(reason)).toBe(
        'Só o dono da empresa pode regularizar o plano. Fale com ele para voltar a usar o MyCarsHub.',
      );
      const text = el.textContent ?? '';
      expect(text, String(reason)).not.toContain('Ver planos');
      expect(text, String(reason)).not.toMatch(/Assine|Escolha um plano/);
    }
  });

  it('quem nao e dono: o botao so reconhece (acknowledged), nunca emite confirmed', () => {
    const el = render('TRIAL_EXPIRED', false);
    const confirmed: unknown[] = [];
    const acknowledged: unknown[] = [];
    fixture.componentInstance.confirmed.subscribe((v) => confirmed.push(v));
    fixture.componentInstance.acknowledged.subscribe((v) => acknowledged.push(v));
    expect(cta(el)?.textContent?.trim()).toBe('Entendi');
    cta(el)?.click();
    expect(acknowledged).toHaveLength(1);
    expect(confirmed).toHaveLength(0);
  });

  it('dono: o botao emite confirmed (e so ele leva ao billing)', () => {
    const el = render('TRIAL_EXPIRED', true);
    const confirmed: unknown[] = [];
    const acknowledged: unknown[] = [];
    fixture.componentInstance.confirmed.subscribe((v) => confirmed.push(v));
    fixture.componentInstance.acknowledged.subscribe((v) => acknowledged.push(v));
    cta(el)?.click();
    expect(confirmed).toHaveLength(1);
    expect(acknowledged).toHaveLength(0);
  });

  it('continua bloqueio duro para todos: sem "Agora nao" e sem fechar pelo fundo', () => {
    for (const canRegularize of [true, false]) {
      const el = render('TRIAL_EXPIRED', canRegularize);
      expect(el.textContent).not.toContain('Agora não');
      const dismissed: unknown[] = [];
      fixture.componentInstance.dismissed.subscribe((v) => dismissed.push(v));
      el.querySelector<HTMLElement>('[aria-hidden="true"].absolute')?.click();
      expect(dismissed).toHaveLength(0);
    }
  });
});
