import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ContractBaseClause } from '../base/contract-base.types';
import { ContractClausesStep } from './clauses-step';
import { ContractQuestionsStep } from './questions-step';
import { ContractUploadStep } from './upload-step';

/**
 * Padrão visual dos passos: sem linhas entre informações (espaço), rótulos em caixa normal,
 * sem pontos de status. Testes de fumaça por ganchos estáveis, não por classe.
 */
describe('contract steps: visual standards', () => {
  const clause = (id: string, fixed: boolean): ContractBaseClause => ({
    id,
    title: `Cláusula ${id}`,
    description: 'descrição',
    fixed,
    defaultOn: false,
    text: '## T',
  });

  it('clauses-step: rótulos em caixa normal e chips sem borda', () => {
    const fixture = TestBed.createComponent(ContractClausesStep);
    fixture.componentRef.setInput('clauses', [clause('a', true), clause('b', false), clause('c', false)]);
    fixture.componentRef.setInput('selected', new Set(['b']));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain('Sempre no contrato');
    expect(host.textContent).toContain('Escolha o que mais entra');
    expect(host.textContent).toContain('1 de 2');
    expect(host.querySelector('.uppercase')).toBeNull();
    expect(host.querySelector('ul li')?.className).not.toContain('border');
  });

  it('upload-step: o «ou» é uma palavra com espaço, sem linhas laterais', () => {
    const fixture = TestBed.createComponent(ContractUploadStep);
    fixture.componentRef.setInput('currentName', 'Contrato atual.docx');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const or = Array.from(host.querySelectorAll('div[aria-hidden="true"]')).find((d) => d.textContent?.trim() === 'ou');
    expect(or).toBeTruthy();
    expect(or?.children.length).toBe(0);
    expect(host.textContent).toContain('Usar o contrato atual');
  });

  it('questions-step: monta sem perguntas e sem linha divisória', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(ContractQuestionsStep);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host).toBeTruthy();
    expect(host.querySelector('.border-t')).toBeNull();
  });
});
