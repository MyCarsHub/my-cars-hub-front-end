import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanIntentService } from './plan-intent.service';
import { SessionService } from './session.service';
import { SessionResetRegistry } from './session-reset.registry';
import { TelemetryService } from './telemetry.service';

/**
 * FIX-0291 — a escolha de plano feita na landing precisa chegar no onboarding.
 *
 * O trajeto SAI DA ORIGEM: landing -> /login -> Google -> /oauth-success ->
 * onboarding. Este spec usa o `SessionService` DE VERDADE, sobre o sessionStorage
 * do jsdom, porque o que esta sob teste e justamente se o valor sobrevive ao
 * `clear()` que o login executa no meio do caminho. Um dublê de armazenamento
 * provaria que o servico chama os metodos certos e nada sobre a travessia.
 */
describe('PlanIntentService — a travessia completa (FIX-0291)', () => {
  let planIntent: PlanIntentService;
  let session: SessionService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: TelemetryService, useValue: { setUser: vi.fn() } },
        SessionResetRegistry,
        SessionService,
        PlanIntentService,
      ],
    });
    planIntent = TestBed.inject(PlanIntentService);
    session = TestBed.inject(SessionService);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  /**
   * A TRAVESSIA INTEIRA, e nao so a escrita: escolher na landing, atravessar o
   * wipe do login, e ser lida no onboarding. Era exatamente aqui que a escolha
   * evaporava.
   */
  it('a escolha sobrevive ao wipe do login e chega no onboarding', () => {
    // landing
    planIntent.remember('PRO');

    // oauth-success: le antes, derruba a sessao inteira, recoloca depois
    const restore = planIntent.preserveAcrossSessionWipe();
    session.clear();
    session.setToken('jwt-novo');
    restore();

    // onboarding
    expect(planIntent.consume()).toBe('PRO');
  });

  it('sem a preservacao, o wipe leva a escolha junto — e a razao de ela existir', () => {
    planIntent.remember('PRO');

    session.clear();

    expect(planIntent.consume()).toBeNull();
  });

  it('consome UMA vez: um segundo onboarding na mesma aba nao herda a escolha', () => {
    planIntent.remember('ENTERPRISE');

    expect(planIntent.consume()).toBe('ENTERPRISE');
    expect(planIntent.consume()).toBeNull();
  });

  /**
   * Escolher o gratuito e dizer "nao vou pagar agora". Deixar uma intencao paga
   * anterior de pe faria o onboarding anunciar um plano que a pessoa ACABOU de
   * recusar.
   */
  it('o TRIAL apaga a intencao em vez de gravar uma', () => {
    planIntent.remember('PRO');

    planIntent.remember('TRIAL');

    expect(planIntent.consume()).toBeNull();
  });

  it('grava os tres pagos', () => {
    for (const tier of ['STARTER', 'PRO', 'ENTERPRISE'] as const) {
      planIntent.remember(tier);
      expect(planIntent.consume()).toBe(tier);
    }
  });

  /** Lixo no armazenamento nao vira plano. */
  it('ignora valor invalido guardado a mao', () => {
    session.setItem('planIntent', 'PLANO_QUE_NAO_EXISTE');

    expect(planIntent.consume()).toBeNull();
  });

  it('preservar quando nao ha escolha nao inventa uma', () => {
    const restore = planIntent.preserveAcrossSessionWipe();
    session.clear();
    restore();

    expect(planIntent.consume()).toBeNull();
  });
});
