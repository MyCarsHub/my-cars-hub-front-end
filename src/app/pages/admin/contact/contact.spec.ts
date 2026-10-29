import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import { ApiErrorService } from '../../../services/api-error.service';
import { NotificationService } from '../../../services/notification.service';
import type { RevealedContact } from '../../../types/admin-contact.types';
import { mailtoLink, withWhatsAppText } from './admin-contact.service';
import { ContactActions } from './contact-actions';
import { ContactBar } from './contact-bar';

const REVEAL_URL = `${environment.apiUrl}/admin/contacts/reveal`;

/** Número fictício. */
const REVEALED: RevealedContact = {
  subjectType: 'DRIVER',
  subjectId: 'drv-1',
  available: true,
  e164: '+5511987654321',
  display: '(11) 98765-4321',
  waLink: 'https://wa.me/5511987654321',
  telLink: 'tel:+5511987654321',
  mobile: true,
  email: 'motorista@example.com',
};

@Component({
  imports: [ContactActions],
  template: `<app-contact-actions subjectType="DRIVER" subjectId="drv-1" [phoneMasked]="masked()"
    label="Fulano" [whatsAppText]="text()" />`,
})
class ActionsHost {
  readonly masked = signal<string | null>('(11) •••••-4321');
  readonly text = signal<string | null>(null);
}

@Component({
  imports: [ContactBar],
  template: `<app-contact-bar subjectType="USER" subjectId="usr-1" [phoneMasked]="masked()"
    fallbackEmail="pessoa@example.com" />`,
})
class BarHost {
  readonly masked = signal<string | null>('(11) •••••-4321');
}

/** Membro de empresa: usuário revelado no contexto da empresa vista. */
@Component({
  imports: [ContactActions],
  template: `<app-contact-actions subjectType="USER" subjectId="usr-9" phoneMasked="(11) •••••-4321"
    contextCompanyId="cmp-7" label="Membro" />`,
})
class MemberActionsHost {}

const notify = { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() };

function configure(): HttpTestingController {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      ApiErrorService,
      { provide: NotificationService, useValue: notify },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('withWhatsAppText / mailtoLink', () => {
  it('codifica o texto com %20 e não monta wa.me sem número', () => {
    expect(withWhatsAppText('https://wa.me/5511987654321', 'Olá, tudo bem?')).toBe(
      'https://wa.me/5511987654321?text=Ol%C3%A1%2C%20tudo%20bem%3F',
    );
    expect(withWhatsAppText('https://wa.me/5511987654321', '  ')).toBe('https://wa.me/5511987654321');
    expect(withWhatsAppText(null, 'x')).toBeNull();
    expect(mailtoLink(null)).toBeNull();
    expect(mailtoLink('a@b.com')).toBe('mailto:a@b.com');
  });
});

describe('ContactActions (lista)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    http = configure();
    vi.clearAllMocks();
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('mostra só o número mascarado: o número inteiro não está no DOM nem é pedido', () => {
    const fixture = TestBed.createComponent(ActionsHost);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-testid="phone-masked"]')?.textContent).toContain('(11) •••••-4321');
    expect(el.textContent).not.toContain('98765');
    expect(el.innerHTML).not.toContain('wa.me');
    http.expectNone(REVEAL_URL);
  });

  it('sem telefone: diz "sem telefone" e não oferece botão', () => {
    const fixture = TestBed.createComponent(ActionsHost);
    fixture.componentInstance.masked.set(null);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-testid="no-phone"]')?.textContent).toContain('sem telefone');
    expect(el.querySelector('[data-testid="contact-whatsapp"]')).toBeNull();
  });

  it('WhatsApp: abre a aba no gesto, revela com canal WHATSAPP e aponta a aba para o wa.me com ?text=', async () => {
    const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const fixture = TestBed.createComponent(ActionsHost);
    fixture.componentInstance.text.set('Olá!');
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="contact-whatsapp"]') as HTMLButtonElement).click();
    expect(open).toHaveBeenCalledWith('', '_blank');

    const req = http.expectOne(REVEAL_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ subjectType: 'DRIVER', subjectId: 'drv-1', channel: 'WHATSAPP' });
    req.flush(REVEALED);
    await flush();

    expect(tab.location.href).toBe('https://wa.me/5511987654321?text=Ol%C3%A1!');
    expect(tab.opener).toBeNull();
  });

  it('WhatsApp sem número válido: fecha a aba e avisa', async () => {
    const tab = { opener: null, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const fixture = TestBed.createComponent(ActionsHost);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="contact-whatsapp"]') as HTMLButtonElement).click();
    http.expectOne(REVEAL_URL).flush({ ...REVEALED, available: false, e164: null, waLink: null, telLink: null });
    await flush();

    expect(tab.close).toHaveBeenCalled();
    expect(notify.warning).toHaveBeenCalledWith('Sem telefone válido cadastrado.');
  });

  it('Ligar revela com canal CALL', async () => {
    const fixture = TestBed.createComponent(ActionsHost);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="contact-call"]') as HTMLButtonElement).click();
    const req = http.expectOne(REVEAL_URL);
    expect(req.request.body.channel).toBe('CALL');
    // Não seguimos o tel: no jsdom (navegação); o canal auditado é o que importa aqui.
    req.flush({ ...REVEALED, telLink: null });
    await flush();
  });

  it('membro de empresa: a revelação leva a empresa vista (o servidor prefere o cadastro de motorista dela)', async () => {
    const fixture = TestBed.createComponent(MemberActionsHost);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="contact-call"]') as HTMLButtonElement).click();
    const req = http.expectOne(REVEAL_URL);
    expect(req.request.body).toEqual({
      subjectType: 'USER',
      subjectId: 'usr-9',
      channel: 'CALL',
      contextCompanyId: 'cmp-7',
    });
    req.flush({ ...REVEALED, telLink: null });
    await flush();
  });
});

describe('ContactBar (detalhe)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    http = configure();
  });

  afterEach(() => http.verify());

  it('revela UMA vez com canal VIEW e vira links de um toque', async () => {
    const fixture = TestBed.createComponent(BarHost);
    fixture.detectChanges();

    const req = http.expectOne(REVEAL_URL);
    expect(req.request.body).toEqual({ subjectType: 'USER', subjectId: 'usr-1', channel: 'VIEW' });
    req.flush({ ...REVEALED, subjectType: 'USER', subjectId: 'usr-1' });
    await flush();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-testid="contact-display"]')?.textContent).toContain('(11) 98765-4321');
    expect(el.querySelector('[data-testid="bar-whatsapp"]')?.getAttribute('href')).toBe(
      'https://wa.me/5511987654321',
    );
    expect(el.querySelector('[data-testid="bar-call"]')?.getAttribute('href')).toBe('tel:+5511987654321');
    expect(el.querySelector('[data-testid="bar-email"]')?.getAttribute('href')).toBe(
      'mailto:motorista@example.com',
    );
  });

  it('sem telefone no servidor: não chama a revelação (nada a auditar) e diz que não há', () => {
    const fixture = TestBed.createComponent(BarHost);
    fixture.componentInstance.masked.set(null);
    fixture.detectChanges();

    http.expectNone(REVEAL_URL);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="contact-none"]')?.textContent).toContain('Sem telefone');
    expect(el.querySelector('[data-testid="bar-whatsapp"]')).toBeNull();
    // O e-mail continua utilizável.
    expect(el.querySelector('[data-testid="bar-email"]')?.getAttribute('href')).toBe('mailto:pessoa@example.com');
  });
});
