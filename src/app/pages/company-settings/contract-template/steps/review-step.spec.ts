import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTENTIQUE_CLAUSE_TEXT, AUTENTIQUE_NOTICE_NOTE, AUTENTIQUE_NOTICE_TITLE } from '../autentique-clause';
import { ContractReviewStep } from './review-step';

/**
 * «Conferir»: contagem em dois cartões de KPI e o aviso (não bloqueante) quando o contrato
 * enviado não cita a assinatura eletrônica.
 */
describe('ContractReviewStep', () => {
  function mount(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(ContractReviewStep);
    fixture.componentRef.setInput('fields', 3);
    fixture.componentRef.setInput('clauses', 12);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('mostra campos e cláusulas em cartões de KPI verdes, sem os blocos feitos à mão', () => {
    const { host } = mount();
    const fields = host.querySelector('[data-testid="review-fields"]') as HTMLElement;
    const clauses = host.querySelector('[data-testid="review-clauses"]') as HTMLElement;

    expect(fields.matches('div[app-kpi-card]')).toBe(true);
    expect(clauses.matches('div[app-kpi-card]')).toBe(true);
    expect(fields.className).toContain('bg-emerald-600');
    expect(fields.textContent).toContain('Dados preenchidos sozinhos');
    expect(clauses.textContent).toContain('Cláusulas');
    expect(host.querySelector('dl')).toBeNull();
  });

  it('usa o singular com 1 campo e 1 cláusula', () => {
    const { host } = mount({ fields: 1, clauses: 1 });
    expect(host.querySelector('[data-testid="review-fields"]')?.textContent).toContain('Dado preenchido sozinho');
    expect(host.querySelector('[data-testid="review-clauses"]')?.textContent).toContain('Cláusula');
    expect(host.querySelector('[data-testid="review-clauses"]')?.textContent).not.toContain('Cláusulas');
  });

  it('rótulos em caixa normal, sem caixa alta nem tracking no «Ao salvar»', () => {
    const { host } = mount();
    const loose = Array.from(host.querySelectorAll('.uppercase')).filter((e) => !e.closest('[app-kpi-card]'));
    expect(loose.length).toBe(0);
    expect(host.textContent).toContain('Ao salvar');
  });

  it('sem menção à assinatura eletrônica: um aviso com a cláusula sugerida e o recado ao advogado', () => {
    const { host } = mount({ esignatureMissing: true });
    const notice = host.querySelector('[data-testid="esignature-notice"]') as HTMLElement;

    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain(AUTENTIQUE_NOTICE_TITLE);
    expect(notice.querySelector('[data-testid="esignature-clause"]')?.textContent?.trim()).toBe(AUTENTIQUE_CLAUSE_TEXT);
    expect(notice.textContent).toContain(AUTENTIQUE_NOTICE_NOTE);
    // Não bloqueia: o botão de salvar mora no pai e este passo não tem nenhum disabled.
    expect(host.querySelector('button[disabled]')).toBeNull();
  });

  it('com a menção presente (ou no «montar do zero»), o aviso não aparece', () => {
    const { host } = mount({ esignatureMissing: false });
    expect(host.querySelector('[data-testid="esignature-notice"]')).toBeNull();
  });

  it('Copiar texto grava a cláusula na área de transferência e mostra o «Copiado»', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { fixture, host } = mount({ esignatureMissing: true });
    const button = host.querySelector('[data-testid="esignature-copy"]') as HTMLButtonElement;

    expect(button.textContent).toContain('Copiar texto');
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(writeText).toHaveBeenCalledWith(AUTENTIQUE_CLAUSE_TEXT);
    expect(button.textContent).toContain('Copiado');
    expect(button.querySelector('.pop')).not.toBeNull();
  });
});
