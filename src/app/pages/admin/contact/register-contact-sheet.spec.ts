import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RegisterContactSheet } from './register-contact-sheet';
import { AdminSegmentsService } from '../segments/admin-segments.service';
import { ApiErrorService } from '../../../services/api-error.service';
import type { CompanyEngagement, RegisterContactRequest } from '../../../types/admin-segments.types';

/** 18/11/2026 (quarta-feira), 16:40 em Brasília. */
const NOW = new Date('2026-11-18T19:40:00Z');

const ENGAGEMENT: CompanyEngagement = {
  segment: 'TRIAL_STALLED',
  segmentReasons: ['NO_RECENT_SIGNAL'],
  recent: null,
  progress: 'SIGNUP_ONLY',
  lastAction: null,
  lastAccessAt: '2026-11-13T22:10:00Z',
  lastSignalAt: '2026-11-13T22:10:00Z',
  deadline: { kind: 'TRIAL_ENDS', at: '2026-11-19T18:00:00Z' },
  fleet: { vehicles: 0, drivers: 0, rentals: 0, activeRentals: 0 },
  openSupportTickets: 0,
  retentionEmailOptOut: false,
  nextAction: { key: 'OFFER_TRIAL_EXTENSION', reason: 'TRIAL_ENDING_SOON' },
  lastContact: null,
  today: { status: 'LISTED', listedReason: 'SEGMENT', hiddenUntil: null },
};

type SheetApi = {
  buildRequest: () => RegisterContactRequest;
  result: { set: (v: string) => void };
  followUp: { set: (v: string) => void };
  extend: { set: (v: boolean) => void };
  channel: { set: (v: string) => void };
  noteControl: { setValue: (v: string) => void };
  dateControl: { setValue: (v: string) => void };
  submit: () => void;
  canSubmit: () => boolean;
};

describe('RegisterContactSheet', () => {
  let registerContact: ReturnType<typeof vi.fn>;

  function render(canExtend = true) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RegisterContactSheet],
      providers: [
        provideNoopAnimations(),
        ApiErrorService,
        { provide: AdminSegmentsService, useValue: { registerContact } },
      ],
    });
    const fixture = TestBed.createComponent(RegisterContactSheet);
    fixture.componentRef.setInput('companyId', 'co-1');
    fixture.componentRef.setInput('companyName', 'Cayque Transportes');
    fixture.componentRef.setInput('engagement', ENGAGEMENT);
    fixture.componentRef.setInput('canExtend', canExtend);
    fixture.componentRef.setInput('now', NOW);
    fixture.detectChanges();
    const api = fixture.componentInstance as unknown as SheetApi;
    const root = () => document.body as HTMLElement;
    return { fixture, api, root };
  }

  // A folha fecha com animação (setTimeout): os relógios falsos a terminam antes do próximo teste.
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    registerContact = vi.fn().mockReturnValue(of({ contact: { id: 'x' }, trialExtension: null, engagement: ENGAGEMENT }));
  });

  it('padrão: WhatsApp, respondeu, retorno amanhã; opcionais vazios ficam fora do corpo', () => {
    const { api } = render();
    expect(api.buildRequest()).toEqual({ channel: 'WHATSAPP', result: 'ANSWERED', followUpDate: '2026-11-19' });
  });

  it('a caixa diz quando a empresa volta para "Hoje, para agir"', () => {
    const { fixture, api } = render();
    const effect = () => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="contact-effect"]')?.textContent?.trim();
    expect(effect()).toBe('Ao salvar, Cayque Transportes sai de “Hoje, para agir” agora e volta amanhã, quinta-feira, 19/11.');
    api.followUp.set('D3');
    fixture.detectChanges();
    expect(effect()).toBe('Ao salvar, Cayque Transportes sai de “Hoje, para agir” agora e volta no sábado, 21/11.');
    api.followUp.set('NONE');
    fixture.detectChanges();
    expect(effect()).toContain('só volta se o segmento dela mudar');
  });

  it('"Não tem interesse" esconde o retorno e nunca manda data (o servidor recusaria)', () => {
    const { fixture, api } = render();
    api.result.set('NOT_INTERESTED');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).not.toContain('Próximo retorno');
    expect(api.buildRequest()).toEqual({ channel: 'WHATSAPP', result: 'NOT_INTERESTED' });
    expect(host.querySelector('[data-testid="contact-effect"]')?.textContent).toContain('das sugestões');
  });

  it('nota aparada; estender manda 7 dias com o motivo de negociação', () => {
    const { api } = render();
    api.channel.set('PHONE');
    api.noteControl.setValue('  Vai assinar na sexta  ');
    api.extend.set(true);
    expect(api.buildRequest()).toEqual({
      channel: 'PHONE',
      result: 'ANSWERED',
      note: 'Vai assinar na sexta',
      followUpDate: '2026-11-19',
      extendTrialDays: 7,
      extendTrialReason: 'NEGOTIATION',
    });
  });

  it('sem permissão de estender, a opção nem aparece e nada vai no corpo', () => {
    const { fixture, api } = render(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="contact-extend"]')).toBeNull();
    api.extend.set(true);
    expect(api.buildRequest().extendTrialDays).toBeUndefined();
  });

  it('"Escolher data" só salva com uma data depois de hoje', () => {
    const { api } = render();
    api.followUp.set('CUSTOM');
    expect(api.canSubmit()).toBe(false);
    api.dateControl.setValue('2026-11-18');
    expect(api.canSubmit()).toBe(false);
    api.dateControl.setValue('2026-11-27');
    expect(api.canSubmit()).toBe(true);
    expect(api.buildRequest().followUpDate).toBe('2026-11-27');
  });

  it('campos com 16px (sem zoom do iOS)', () => {
    const { fixture } = render();
    const note = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="contact-note"]') as HTMLElement;
    expect(note.className).toContain('text-base');
  });

  it('salva, avisa quem abriu e mostra a recusa do servidor dentro da folha', () => {
    const { fixture, api } = render();
    const saved = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    api.submit();
    expect(registerContact).toHaveBeenCalledWith('co-1', expect.objectContaining({ channel: 'WHATSAPP' }));
    expect(saved).toHaveBeenCalledTimes(1);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    vi.advanceTimersByTime(300);
    expect(closed).toHaveBeenCalledTimes(1);

    registerContact.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Empresa paga não tem teste para estender.' } })),
    );
    const second = render();
    second.api.submit();
    second.fixture.detectChanges();
    expect((second.fixture.nativeElement as HTMLElement).textContent).toContain('Empresa paga não tem teste para estender.');
  });
});
