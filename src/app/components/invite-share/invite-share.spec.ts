import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteShare } from './invite-share';
import { NotificationService } from '../../services/notification.service';

@Component({
  imports: [InviteShare],
  template: `<app-invite-share [link]="link()" [companyName]="company()" />`,
})
class Host {
  readonly link = signal('https://mycarshub.app.br/convite/tok_1');
  readonly company = signal<string | null>('Locadora Sol');
}

describe('InviteShare — copiar e enviar o link do convite', () => {
  let fixture: ComponentFixture<Host>;
  let success: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.fn>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const copyButton = (): HTMLButtonElement =>
    root().querySelector('[data-copy-link]') as HTMLButtonElement;
  const status = (): string => root().querySelector('[data-share-status]')?.textContent?.trim() ?? '';

  function stub(target: object, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
  }

  /** A macrotask: every promise the click started has resolved by the time it returns. */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  function render(): void {
    TestBed.resetTestingModule();
    success = vi.fn();
    error = vi.fn();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: NotificationService, useValue: { success, error } }],
    });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  }

  beforeEach(() => render());

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>)['clipboard'];
    delete (navigator as unknown as Record<string, unknown>)['share'];
    delete (document as unknown as Record<string, unknown>)['execCommand'];
  });

  it('mostra o link em um campo somente leitura de 16px, com rotulo', () => {
    const field = root().querySelector<HTMLInputElement>('[data-share-link]');
    expect(field?.value).toBe('https://mycarshub.app.br/convite/tok_1');
    expect(field?.readOnly).toBe(true);
    expect(field?.className).toContain('text-base');
    expect(root().querySelector(`label[for="${field?.id}"]`)?.textContent).toContain('Link do convite');
  });

  it('copiar: usa a Clipboard API, avisa no toast E deixa o estado visivel e anunciado', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stub(navigator, 'clipboard', { writeText });

    expect(status()).toBe('');
    copyButton().click();
    await settle();

    expect(writeText).toHaveBeenCalledWith('https://mycarshub.app.br/convite/tok_1');
    expect(success).toHaveBeenCalledWith('Link copiado');
    expect(copyButton().textContent).toContain('Link copiado');
    expect(status()).toContain('Link copiado');
    const live = root().querySelector('[data-share-status]');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
  });

  it('copiar sem Clipboard API: cai no textarea + execCommand e confirma do mesmo jeito', async () => {
    const execCommand = vi.fn(() => true);
    stub(document, 'execCommand', execCommand);

    copyButton().click();
    await settle();

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(success).toHaveBeenCalledWith('Link copiado');
    expect(copyButton().textContent).toContain('Link copiado');
  });

  it('copiar que nenhum caminho consegue: diz isso no lugar, sem fingir "copiado"', async () => {
    copyButton().click();
    await settle();

    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    expect(copyButton().textContent).not.toContain('Link copiado');
    expect(status()).toContain('Não foi possível copiar');
  });

  it('WhatsApp e uma ancora real: wa.me, texto codificado, nova aba, noopener', () => {
    const a = root().querySelector<HTMLAnchorElement>('[data-whatsapp-link]');

    expect(a?.textContent).toContain('Enviar pelo WhatsApp');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
    const href = a?.getAttribute('href') ?? '';
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    const text = new URL(href).searchParams.get('text') ?? '';
    expect(text).toContain('Locadora Sol');
    expect(text).toContain('https://mycarshub.app.br/convite/tok_1');
  });

  it('o botao Compartilhar so aparece onde navigator.share existe — e WhatsApp fica sempre', () => {
    expect(root().querySelector('[data-native-share]')).toBeNull();
    expect(root().querySelector('[data-whatsapp-link]')).not.toBeNull();

    stub(navigator, 'share', vi.fn().mockResolvedValue(undefined));
    render();

    expect(root().querySelector('[data-native-share]')).not.toBeNull();
    expect(root().querySelector('[data-whatsapp-link]')).not.toBeNull();
  });

  it('Compartilhar chama navigator.share com o texto que traz o link', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stub(navigator, 'share', share);
    render();

    root().querySelector<HTMLButtonElement>('[data-native-share]')?.click();
    await settle();

    expect(share).toHaveBeenCalledTimes(1);
    expect((share.mock.calls[0][0] as { text: string }).text).toContain(
      'https://mycarshub.app.br/convite/tok_1',
    );
  });

  it('um link novo zera o "copiado": o estado antigo nao descreve o link novo', async () => {
    stub(navigator, 'clipboard', { writeText: vi.fn().mockResolvedValue(undefined) });
    copyButton().click();
    await settle();
    expect(copyButton().textContent).toContain('Link copiado');

    fixture.componentInstance.link.set('https://mycarshub.app.br/convite/tok_2');
    await settle();

    expect(copyButton().textContent).toContain('Copiar link');
    expect(status()).toBe('');
  });

  it('os alvos de toque tem 48px de altura minima', () => {
    expect(copyButton().className).toContain('min-h-12');
    expect(root().querySelector('[data-whatsapp-link]')?.className).toContain('min-h-12');
  });
});
