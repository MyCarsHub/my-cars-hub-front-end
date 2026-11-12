import { DeferBlockState, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component, Type } from '@angular/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanyContactService } from '../../services/company-contact.service';
import { EMPTY_COMPANY_CONTACT } from '../../types/company-contact.types';
import { NoticeOutcome, NoticesService } from './notices.service';
import { NoticesPopup } from './notices-popup';

@Component({ imports: [NoticesPopup], template: '<app-notices-popup />' })
class Host {}


/**
 * O cartão v2 do popup vem por `@defer`. Carrega o bloco UMA vez (renderiza e desmonta) para
 * que os blocos seguintes renderizem na hora, como num app que já baixou o pedaço.
 */
async function warmNewsCard(host: Type<unknown>): Promise<void> {
  const notices = TestBed.inject(NoticesService);
  notices.enqueue({ id: 'news:warm-up', type: 'NEWS', title: 'w', message: 'w' }).subscribe();
  const f = TestBed.createComponent(host);
  f.detectChanges();
  for (const block of await f.getDeferBlocks()) await block.render(DeferBlockState.Complete);
  notices.dismiss('news:warm-up');
  f.destroy();
}

describe('NoticesPopup', () => {
  let notices: NoticesService;

  beforeEach(async () => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideRouter([]),
        {
          provide: CompanyContactService,
          useValue: { load: () => of({ name: 'Locadora', contact: EMPTY_COMPANY_CONTACT }), save: vi.fn() },
        },
      ],
    });
    notices = TestBed.inject(NoticesService);
    await warmNewsCard(Host);
  });

  afterEach(() => vi.useRealTimers());

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: { nativeElement: HTMLElement }, sel: string) =>
    f.nativeElement.querySelector<HTMLElement>(sel);

  it('renders nothing while the queue is empty', () => {
    const f = render();
    expect(el(f, '[data-testid="bottom-sheet"]')).toBeNull();
  });

  it('shows a typed notice with its items, and a REMINDER chip', () => {
    const f = render();
    notices.enqueue({ id: 'r', type: 'REMINDER', title: 'Complete', message: 'Falta', items: ['telefone', 'CEP'] });
    f.detectChanges();
    expect(el(f, '[data-testid="notice-type"]')?.textContent).toContain('Lembrete');
    const items = Array.from((f.nativeElement as HTMLElement).querySelectorAll('[data-testid="notice-items"] li')).map((li) => li.textContent?.trim());
    expect(items).toEqual(['telefone', 'CEP']);
  });

  it('labels NEWS differently', () => {
    const f = render();
    notices.enqueue({ id: 'n', type: 'NEWS', title: 'Novo', message: 'Veja' });
    f.detectChanges();
    expect(el(f, '[data-testid="notice-type"]')?.textContent).toContain('Novidade');
  });

  it('a dismissible notice has the X and the dismiss button resolves the queue as dismissed', () => {
    const f = render();
    const seen: NoticeOutcome[] = [];
    notices.enqueue({ id: 'r', type: 'REMINDER', title: 'T', message: 'm' }).subscribe((o) => seen.push(o));
    f.detectChanges();
    expect(el(f, '[data-testid="bottom-sheet-close"]')).not.toBeNull();
    el(f, '[data-testid="notice-dismiss"]')?.click();
    vi.runAllTimers();
    f.detectChanges();
    expect(seen).toEqual(['dismissed']);
    expect(el(f, '[data-testid="bottom-sheet"]')).toBeNull();
  });

  it('a blocking notice has no X, ignores Esc and the backdrop; only its button leaves', () => {
    const f = render();
    const seen: NoticeOutcome[] = [];
    notices.enqueue({ id: 'b', type: 'REMINDER', title: 'T', message: 'm', blocking: true }).subscribe((o) => seen.push(o));
    f.detectChanges();
    expect(el(f, '[data-testid="bottom-sheet-close"]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.runAllTimers();
    f.detectChanges();
    expect(seen).toEqual([]);
    expect(notices.current()?.id).toBe('b');
    el(f, '[data-testid="notice-dismiss"]')?.click();
    vi.runAllTimers();
    expect(seen).toEqual(['dismissed']);
  });

  it('the link button dismisses the notice and navigates to /configuracoes/contato', () => {
    const f = render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    notices.enqueue({
      id: 'l', type: 'REMINDER', title: 'T', message: 'm',
      link: { label: 'Abrir em Configurações', route: '/configuracoes/contato' },
    });
    f.detectChanges();
    el(f, '[data-testid="notice-link"]')?.click();
    vi.runAllTimers();
    expect(navigate).toHaveBeenCalledWith('/configuracoes/contato');
  });

  it('shows the next notice after the first leaves', () => {
    const f = render();
    notices.enqueue({ id: 'a', type: 'REMINDER', title: 'A', message: 'm' });
    notices.enqueue({ id: 'b', type: 'NEWS', title: 'B', message: 'm' });
    f.detectChanges();
    el(f, '[data-testid="notice-dismiss"]')?.click();
    vi.runAllTimers();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('B');
  });
});
