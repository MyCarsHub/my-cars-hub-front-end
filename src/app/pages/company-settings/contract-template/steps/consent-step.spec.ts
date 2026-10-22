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

  it('o prazo de 30 dias vem com a mesma exceção da Política §6.6 (até 2 anos)', () => {
    const { text } = mount();
    expect(text).toContain('o apaga em até 30 dias');
    expect(text).toContain(
      'Pelas regras da própria Anthropic, a exceção é o conteúdo que a lei obrigue a guardar ou que os sistemas automáticos de segurança dela sinalizem como possível violação da política de uso, que pode ser guardado por até 2 anos.',
    );
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

describe('ContractConsentStep — provedor da rota', () => {
  it('mostra quem recebe o texto (provedor e modelos) e nomeia o provedor na autorização', () => {
    const fixture = TestBed.createComponent(ContractConsentStep);
    fixture.componentRef.setInput('providers', [
      { provider: 'anthropic', label: 'Anthropic', models: ['claude-haiku-5-5', 'claude-opus-5-5'] },
    ]);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const text = (host.textContent ?? '').replace(/\s+/g, ' ');
    expect(host.querySelector('[data-ai-route]')?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Anthropic · modelos claude-haiku-5-5 e claude-opus-5-5',
    );
    expect(text).toContain('autorizo o envio deste texto à Anthropic, nos Estados Unidos');
  });

  it('com o motivo do novo pedido, avisa antes da autorização', () => {
    const fixture = TestBed.createComponent(ContractConsentStep);
    fixture.componentRef.setInput('reason', 'O serviço de IA mudou.');
    fixture.detectChanges();
    const alert = (fixture.nativeElement as HTMLElement).querySelector('[role=alert]');
    expect(alert?.textContent).toContain('O serviço de IA mudou.');
  });
});
