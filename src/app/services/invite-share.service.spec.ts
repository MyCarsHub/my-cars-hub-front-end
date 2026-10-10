import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteShareService } from './invite-share.service';

/**
 * The service is the only place that touches the clipboard, `window.open` and
 * `navigator.share`, so the browser surfaces are stubbed here and every other spec can
 * stay on the DOM.
 */
describe('InviteShareService', () => {
  const LINK = 'https://mycarshub.app.br/convite/tok_abc123?x=1&y=2';

  let service: InviteShareService;

  function stub(target: object, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
  }

  function unstub(target: object, key: string): void {
    delete (target as Record<string, unknown>)[key];
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    service = TestBed.inject(InviteShareService);
  });

  afterEach(() => {
    unstub(navigator, 'clipboard');
    unstub(navigator, 'share');
    unstub(document, 'execCommand');
    vi.restoreAllMocks();
  });

  describe('texto e URL do WhatsApp', () => {
    it('usa wa.me com o texto CODIFICADO, trazendo o nome da empresa e o link inteiro', () => {
      const url = service.whatsAppUrl(LINK, 'Locadora Sol');

      expect(url.startsWith('https://wa.me/?text=')).toBe(true);
      // The raw link has `?`, `&` and `=`: left bare they would cut the message short.
      expect(url.slice('https://wa.me/?text='.length)).not.toMatch(/[?&=\s]/);
      const decoded = new URL(url).searchParams.get('text') ?? '';
      expect(decoded).toContain('Locadora Sol');
      expect(decoded).toContain(LINK);
      expect(decoded).toContain('MyCarsHub');
    });

    it('sem nome de empresa a frase continua inteira e ainda traz o link', () => {
      const decoded = new URL(service.whatsAppUrl(LINK, null)).searchParams.get('text') ?? '';

      expect(decoded).toContain(LINK);
      expect(decoded).not.toContain('null');
      expect(decoded).not.toContain('undefined');
      expect(decoded).not.toMatch(/\s{2,}/);
    });

    it('nome em branco conta como ausente', () => {
      expect(service.message(LINK, '   ')).toBe(service.message(LINK, null));
    });
  });

  describe('abrir o WhatsApp', () => {
    it('abre a URL do wa.me em outra aba e corta o opener', () => {
      const opened = { opener: {} as unknown } as unknown as Window;
      const open = vi.spyOn(window, 'open').mockReturnValue(opened);

      expect(service.openWhatsApp(LINK, 'Locadora Sol')).toBe(true);

      expect(open).toHaveBeenCalledWith(service.whatsAppUrl(LINK, 'Locadora Sol'), '_blank');
      expect(opened.opener).toBeNull();
    });

    it('devolve false quando o navegador bloqueia a aba', () => {
      vi.spyOn(window, 'open').mockReturnValue(null);

      expect(service.openWhatsApp(LINK, 'Locadora Sol')).toBe(false);
    });
  });

  describe('copiar', () => {
    it('usa a Clipboard API quando existe', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      stub(navigator, 'clipboard', { writeText });

      await expect(service.copy(LINK)).resolves.toBe(true);

      expect(writeText).toHaveBeenCalledWith(LINK);
    });

    it('sem Clipboard API (contexto inseguro) cai no textarea escondido + execCommand', async () => {
      const execCommand = vi.fn((command: string) => {
        // The text must be selected inside a rendered textarea at the moment of the copy.
        const area = document.querySelector('textarea');
        expect(command).toBe('copy');
        expect(area?.value).toBe(LINK);
        return true;
      });
      stub(document, 'execCommand', execCommand);

      await expect(service.copy(LINK)).resolves.toBe(true);

      expect(execCommand).toHaveBeenCalledTimes(1);
      // And it cleans up after itself: no stray field holding the link.
      expect(document.querySelector('textarea')).toBeNull();
    });

    it('Clipboard API recusando (permissao) tambem cai no textarea', async () => {
      const writeText = vi.fn().mockRejectedValue(new DOMException('negado', 'NotAllowedError'));
      stub(navigator, 'clipboard', { writeText });
      const execCommand = vi.fn(() => true);
      stub(document, 'execCommand', execCommand);

      await expect(service.copy(LINK)).resolves.toBe(true);

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(execCommand).toHaveBeenCalledWith('copy');
    });

    it('devolve false (sem lancar) quando nenhum caminho funciona', async () => {
      stub(navigator, 'clipboard', {
        writeText: vi.fn().mockRejectedValue(new Error('negado')),
      });
      stub(document, 'execCommand', vi.fn(() => false));

      await expect(service.copy(LINK)).resolves.toBe(false);
      expect(document.querySelector('textarea')).toBeNull();
    });

    it('sem Clipboard API e sem execCommand tambem devolve false', async () => {
      await expect(service.copy(LINK)).resolves.toBe(false);
    });
  });

  describe('compartilhar pelo sistema', () => {
    it('so existe onde navigator.share existe', () => {
      expect(service.canNativeShare()).toBe(false);
      stub(navigator, 'share', vi.fn());
      expect(service.canNativeShare()).toBe(true);
    });

    it('manda o texto com o link', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      stub(navigator, 'share', share);

      await expect(service.nativeShare(LINK, 'Locadora Sol')).resolves.toBe('shared');

      const payload = share.mock.calls[0][0] as { text: string };
      expect(payload.text).toContain(LINK);
      expect(payload.text).toContain('Locadora Sol');
    });

    it('fechar a folha do sistema nao e erro', async () => {
      stub(navigator, 'share', vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')));

      await expect(service.nativeShare(LINK)).resolves.toBe('cancelled');
    });

    it('outra falha e falha', async () => {
      stub(navigator, 'share', vi.fn().mockRejectedValue(new Error('boom')));

      await expect(service.nativeShare(LINK)).resolves.toBe('failed');
    });
  });
});
