import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ContractConsentStep } from './consent-step';
import { AI_SEND_NOTICE } from '../ai/contract-ai.messages';

/**
 * Consentimento v2 na tela nova: é a base da transferência internacional (LGPD art. 33, VIII)
 * e tem de dizer a verdade sobre o mascaramento. O IdentifierMasker do backend esconde CPF,
 * CNPJ, RG, placa, chassi, Renavam, telefone, e-mail, CEP e demais números; nomes e endereços
 * vão em claro (seção 6 da Política).
 */
describe('ContractConsentStep', () => {
  function mount() {
    const fixture = TestBed.createComponent(ContractConsentStep);
    fixture.componentRef.setInput('where', 'ao lado');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    return { host, text: (host.textContent ?? '').replace(/\s+/g, ' ') };
  }

  it('nomeia a Anthropic, os EUA e a base legal da transferência', () => {
    const { text } = mount();
    expect(text).toContain('será enviado à Anthropic (serviço de IA Claude), nos Estados Unidos');
    expect(text).toContain('O texto sai do Brasil');
    expect(text).toContain('art. 33, VIII');
  });

  it('diz o que vai escondido e o que vai em claro, igual ao mascarador e à Política', () => {
    const { text } = mount();
    expect(text).toContain(
      'Vão escondidos: CPF, CNPJ, telefone, e-mail, placa, CEP, chassi, RG, Renavam e outros números.',
    );
    expect(text).toContain('Vão em claro: nomes de pessoas e de empresas, endereços');
    // A frase antiga prometia esconder nomes e endereços, o que o mascarador não faz.
    expect(text).not.toContain('ficam escondidos');
    expect(text).not.toMatch(/Nome, CPF, CNH, placa e endereços/);
  });

  it('as duas metades na tela são exatamente o texto do consentimento v2', () => {
    expect(`${AI_SEND_NOTICE.masked} ${AI_SEND_NOTICE.inClear}`).toBe(AI_SEND_NOTICE.hidden);
  });

  it('a autorização nomeia a Anthropic e o país, e linka a seção 6 em nova aba', () => {
    const { host, text } = mount();
    expect(text).toContain('autorizo o envio deste texto à Anthropic, nos Estados Unidos, para análise');
    const link = host.querySelector<HTMLAnchorElement>(
      'a[href="/politica-de-privacidade#analise-de-contrato-com-ia"]',
    );
    expect(link).not.toBeNull();
    expect(link!.target).toBe('_blank');
    expect(link!.rel).toContain('noopener');
  });
});
