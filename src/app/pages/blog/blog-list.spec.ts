import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlogList } from './blog-list';
import { BlogService } from './blog.service';
import { ApiErrorService } from '../../services/api-error.service';
import { NotificationService } from '../../services/notification.service';

/**
 * FIX-0325 — a listagem do blog era uma das duas ultimas telas com extrator
 * proprio, e a pior ocorrencia do defeito do FIX-0050.
 *
 * O `extractError` local aceitava QUALQUER objeto com `message`, entao numa
 * falha de rede lia o TypeError do navegador e escrevia "Failed to fetch" na
 * pagina — em ingles cru, para um leitor ANONIMO, numa superficie de marketing.
 *
 * Primeiro spec desta tela: ela nao tinha nenhum.
 */
describe('BlogList — caminho de erro compartilhado (FIX-0325)', () => {
  let fixture: ComponentFixture<BlogList>;
  let listPublished: ReturnType<typeof vi.fn>;
  let notifyError: ReturnType<typeof vi.fn>;

  function render(): void {
    fixture = TestBed.createComponent(BlogList);
    fixture.detectChanges();
  }

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  }

  beforeEach(() => {
    listPublished = vi.fn();
    notifyError = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BlogList],
      providers: [
        provideRouter([]),
        ApiErrorService,
        { provide: BlogService, useValue: { listPublished } },
        {
          provide: NotificationService,
          useValue: {
            error: notifyError,
            warning: vi.fn(),
            info: vi.fn(),
            success: vi.fn(),
            push: vi.fn(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falha de rede mostra o fallback em portugues, nao "Failed to fetch"', () => {
    listPublished.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') })),
    );

    render();

    expect(text()).toContain('Não foi possível carregar os posts.');
    expect(text()).not.toContain('Failed to fetch');
  });

  /**
   * A copy existente NAO pode mudar: `messageFor` sem fallback cairia em
   * "Registro não encontrado." num 404, que nao e a frase desta tela.
   */
  it('preserva a copy da tela quando o backend nao explica', () => {
    listPublished.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404, error: {} })),
    );

    render();

    expect(text()).toContain('Não foi possível carregar os posts.');
    expect(text()).not.toContain('Registro não encontrado');
  });

  it('mostra fieldErrors, que o extrator local ignorava', () => {
    listPublished.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { fieldErrors: { category: 'Categoria inexistente.' } },
          }),
      ),
    );

    render();

    expect(text()).toContain('Categoria inexistente.');
  });

  it('continua mostrando a mensagem do backend quando ela vem', () => {
    listPublished.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 500, error: { message: 'Blog em manutenção.' } }),
      ),
    );

    render();

    expect(text()).toContain('Blog em manutenção.');
  });

  it('reivindica o erro — nada de toast por cima da mensagem na pagina', () => {
    vi.useFakeTimers();
    const failure = new HttpErrorResponse({ status: 400, error: { message: 'Pedido inválido.' } });
    listPublished.mockReturnValue(throwError(() => failure));

    render();
    TestBed.inject(ApiErrorService).scheduleSafetyNet(failure);
    vi.runAllTimers();

    expect(text()).toContain('Pedido inválido.');
    expect(notifyError).not.toHaveBeenCalled();
  });

  /** Controle: um erro que NINGUEM reivindicou continua toastando. */
  it('controle: erro nao reivindicado ainda dispara a rede de seguranca', () => {
    vi.useFakeTimers();
    listPublished.mockReturnValue(of({ content: [], page: 0, size: 12, total: 0 }));
    render();

    const orphan = new HttpErrorResponse({ status: 400, error: { message: 'Sem dono.' } });
    TestBed.inject(ApiErrorService).scheduleSafetyNet(orphan);
    vi.runAllTimers();

    expect(notifyError).toHaveBeenCalledWith('Sem dono.');
  });
});
