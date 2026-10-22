import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ContractWordStep } from './word-step';

/**
 * «Já sei colocar os campos no Word»: o único lugar em que a chave aparece, porque a pessoa
 * precisa digitá-la. Mesmo aqui o nome em português vem primeiro, em destaque.
 */
describe('ContractWordStep', () => {
  it('mostra o nome do campo em português em destaque e a chave como texto secundário', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(ContractWordStep);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    const label = host.querySelector('ol [data-field-label]');
    const code = host.querySelector('ol code');
    expect(label?.textContent?.trim()).toBe('Nome do motorista');
    expect(code?.textContent?.trim()).toBe('{{driverName}}');
    // A chave nunca é o único texto do passo.
    const step = (host.querySelector('ol li')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(step.indexOf('Nome do motorista')).toBeLessThan(step.indexOf('{{driverName}}'));
  });
});
