import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BlockAnswer, BlockView } from '../ai/contract-ai.types';
import { ContractBlockAsk } from './block-ask';

const confirm: BlockView = {
  id: 'b0001',
  kind: 'CONFIRM',
  party: 'COMPANY',
  partyLabel: 'Locadora',
  aiParty: null,
  aiEvidence: null,
  source: 'HEADING',
  label: 'Informações do Locador',
  sectionPath: ['Contrato', 'Informações do Locador'],
  options: [
    { party: 'DRIVER', label: 'Motorista (Locatário)' },
    { party: 'COMPANY', label: 'Locadora' },
  ],
  appliesTo: 2,
  items: [
    {
      id: 'q0001',
      kind: 'NAME',
      excerpt: 'Marcos Silva',
      context: 'Nome: Marcos Silva',
      places: [{ paragraphId: 'p1', excerpt: 'Marcos Silva' }],
      fieldsByParty: { COMPANY: [{ field: 'companyRepresentative', label: 'Representante da locadora' }] },
    },
    {
      id: 'q0002',
      kind: 'CPF',
      excerpt: '529.982.247-25',
      context: 'CPF: 529.982.247-25',
      places: [{ paragraphId: 'p2', excerpt: '529.982.247-25' }],
      fieldsByParty: {},
    },
  ],
};

const ask: BlockView = {
  ...confirm,
  id: 'b0002',
  kind: 'QUESTION',
  party: null,
  partyLabel: null,
  source: 'NONE',
  label: null,
  sectionPath: ['Cláusula 8 – Avisos'],
  appliesTo: 2,
  items: [
    {
      id: 'q0005',
      kind: 'ADDRESS',
      excerpt: 'Rua Sete de Setembro, 45',
      context: 'Os avisos serão enviados para Rua Sete de Setembro, 45, telefone (19) 3222-1100.',
      places: [{ paragraphId: 'p8', excerpt: 'Rua Sete de Setembro, 45' }],
      fieldsByParty: {
        DRIVER: [{ field: 'driverAddress', label: 'Endereço do motorista' }],
        COMPANY: [{ field: 'companyAddress', label: 'Endereço da locadora' }],
      },
    },
  ],
};

const witness: BlockView = {
  ...ask,
  id: 'b0003',
  aiParty: 'THIRD',
  aiEvidence: 'Testemunha:',
  options: [...confirm.options, { party: 'THIRD', label: 'Contato de terceiro do motorista' }],
  items: [
    {
      id: 'q0007',
      kind: 'NAME',
      excerpt: 'Carla Menezes Ribeiro',
      context: 'Testemunha: Carla Menezes Ribeiro, CPF 390.533.447-05',
      places: [{ paragraphId: 'p9', excerpt: 'Carla Menezes Ribeiro' }],
      fieldsByParty: {
        THIRD: [
          { field: 'driverReference1', label: 'Referência 1 do motorista' },
          { field: 'driverReference2', label: 'Referência 2 do motorista' },
          { field: 'driverReference3', label: 'Referência 3 do motorista' },
        ],
      },
    },
  ],
};

function mount(block: BlockView, answered: BlockAnswer | null = null, references: Record<string, string> = {}) {
  const fixture = TestBed.createComponent(ContractBlockAsk);
  fixture.componentRef.setInput('block', block);
  fixture.componentRef.setInput('answered', answered);
  fixture.componentRef.setInput('references', references);
  const answers: BlockAnswer[] = [];
  const refs: { itemId: string; field: string | null }[] = [];
  fixture.componentInstance.answer$.subscribe((a) => answers.push(a));
  fixture.componentInstance.reference.subscribe((r) => refs.push(r));
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const text = () => host.textContent?.replace(/\s+/g, ' ') ?? '';
  return { fixture, host, text, answers, refs };
}

describe('ContractBlockAsk', () => {
  it('bloco com parte: mostra os dados reais e confirma com um toque em «Está certo»', () => {
    const { host, text, answers } = mount(confirm);
    expect(text()).toContain('Encontramos estes dados da Locadora');
    expect(text()).toContain('«Informações do Locador»');
    expect(text()).toContain('Marcos Silva');
    expect(text()).toContain('529.982.247-25');
    expect(text()).toContain('Representante da locadora');
    expect(text()).toContain('Fica como está');
    expect(text()).toContain('Esta resposta vale para 2 itens');
    // Nada marcado antes do toque.
    expect(host.querySelector('[data-block-ok]')?.getAttribute('aria-checked')).toBe('false');
    (host.querySelector('[data-block-ok]') as HTMLButtonElement).click();
    expect(answers).toEqual(['COMPANY']);
  });

  it('«Corrigir» abre as partes; sem Terceiro quando ninguém disse terceiro', () => {
    const { host, fixture, text, answers } = mount(confirm);
    expect(host.querySelector('[data-party="DRIVER"]')).toBeNull();
    (host.querySelector('[data-block-fix]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(text()).toContain('Do Motorista (Locatário)');
    expect(text()).toContain('locador, dono, representante ou a própria locadora');
    expect(host.querySelector('[data-party="THIRD"]')).toBeNull();
    (host.querySelector('[data-party="DRIVER"]') as HTMLButtonElement).click();
    expect(answers).toEqual(['DRIVER']);
  });

  it('pergunta sem escopo: título pelo dado, trecho real, duas respostas, «deixar fixo» e o alcance', () => {
    const { host, fixture, text, answers } = mount(ask);
    expect(text()).toContain('Este endereço é de quem?');
    expect(text()).toContain('Seção: Cláusula 8 – Avisos');
    expect(host.querySelector('mark')?.textContent).toBe('Rua Sete de Setembro, 45');
    expect(text()).toContain('Do Motorista (Locatário)');
    expect(text()).toContain('Da Locadora');
    expect(text()).toContain('Não é de nenhum dos dois: deixar fixo');
    expect(text()).toContain('Esta resposta vale para 2 itens');
    expect(host.querySelectorAll('[role="radio"][aria-checked="true"]').length).toBe(0);
    // Nenhum texto mascarado na tela.
    expect(text()).not.toMatch(/\[[A-Z]+_\d+\]|escondid/);
    (host.querySelector('[data-block-reach]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(text()).toContain('Endereço');
    (host.querySelector('[data-party="NONE"]') as HTMLButtonElement).click();
    expect(answers).toEqual(['NONE']);
  });

  it('a leitura achou testemunha: Terceiro aparece com «Parece ser esta», sem vir marcado, e sem parentesco', () => {
    const { host, text } = mount(witness);
    const third = host.querySelector('[data-party="THIRD"]');
    expect(third?.textContent).toContain('Contato de terceiro do motorista');
    expect(third?.textContent).toContain('Parece ser esta');
    expect(third?.getAttribute('aria-checked')).toBe('false');
    expect(text()).toContain('porque o contrato diz «Testemunha:»');
    expect(text()).not.toMatch(/parentesco|Irmão|Mãe|Pai\b/i);
  });

  it('Terceiro escolhido: escolhe qual referência (1 a 3) o nome vira', () => {
    const { host, fixture, refs } = mount(witness, 'THIRD');
    const picker = host.querySelector('[data-block-reference]');
    expect(picker?.textContent).toContain('Referência 1');
    expect(picker?.textContent).toContain('Referência 3');
    expect(picker?.textContent).toContain('Deixar o nome fixo');
    const two = Array.from(picker!.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Referência 2');
    two!.click();
    expect(refs).toEqual([{ itemId: 'q0007', field: 'driverReference2' }]);
    fixture.componentRef.setInput('references', { q0007: 'driverReference2' });
    fixture.detectChanges();
    expect(two!.getAttribute('aria-checked')).toBe('true');
  });

  it('botões com área de toque ≥ 44px e sem linhas divisórias', () => {
    const { host, fixture } = mount(ask);
    fixture.detectChanges();
    for (const b of Array.from(host.querySelectorAll('button'))) {
      expect(b.className).toMatch(/min-h-\[(44|48|60)px\]/);
    }
    expect(host.querySelector('.border-t, .border-b, .divide-y')).toBeNull();
  });
});
