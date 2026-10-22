import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ContractPaper } from './contract-paper';
import { PaperParagraph } from './contract-paper.model';

describe('ContractPaper', () => {
  function mount(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(ContractPaper);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }
  const legend = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('[aria-label="Legenda das cores"] li')).map((li) =>
      li.textContent?.trim(),
    );

  it('vazio: a folha fantasma e o texto, sem legenda nem folha de verdade', () => {
    const { host } = mount({ emptyText: 'O contrato aparece aqui.' });
    expect(host.textContent).toContain('O contrato aparece aqui.');
    expect(host.querySelector('article')).toBeNull();
    expect(legend(host)).toEqual([]);
  });

  it('a legenda mostra só as cores que estão na folha', () => {
    const paragraphs: PaperParagraph[] = [
      {
        id: 'p1',
        role: 'body',
        segments: [
          { kind: 'text', text: 'LOCATÁRIO: ' },
          { kind: 'field', field: 'driverName', tone: 'ok' },
          { kind: 'text', text: ', CPF ' },
          { kind: 'hidden', label: 'CPF escondido' },
        ],
      },
    ];
    const { fixture, host } = mount({ paragraphs });
    expect(legend(host)).toEqual(['Preenchido sozinho', 'Escondido da IA']);

    fixture.componentRef.setInput('paragraphs', [
      { id: 'p1', role: 'body', segments: [{ kind: 'field', field: 'periodRate', tone: 'doubt' }] },
    ]);
    fixture.detectChanges();
    expect(legend(host)).toEqual(['Pergunta da IA']);
  });

  it('«Local e data»: a cidade da empresa aparece como exemplo e como campo', () => {
    const paragraphs: PaperParagraph[] = [
      {
        id: 'local',
        role: 'body',
        segments: [
          { kind: 'field', field: 'companyCity', tone: 'ok' },
          { kind: 'text', text: ', ' },
          { kind: 'field', field: 'contractDate', tone: 'ok' },
          { kind: 'text', text: '.' },
        ],
      },
    ];
    const { fixture, host } = mount({ paragraphs });
    const p = () => host.querySelector('article p')?.textContent ?? '';
    expect(p()).toMatch(/^São Paulo, /);
    expect(host.querySelector('article p span')?.getAttribute('title')).toBe('Cidade da empresa');
    fixture.componentRef.setInput('mode', 'names');
    fixture.detectChanges();
    expect(p()).toMatch(/^\{\{companyCity\}\}, /);
  });

  it('o texto do contrato continua só interpolado, sem espaço extra entre os pedaços', () => {
    const paragraphs: PaperParagraph[] = [
      {
        id: 'p1',
        role: 'body',
        segments: [
          { kind: 'field', field: 'vehicleBrand', tone: 'ok' },
          { kind: 'text', text: ', ano 2024.' },
        ],
      },
    ];
    const { host } = mount({ paragraphs, mode: 'names' });
    expect(host.querySelector('article p')?.textContent).toBe('{{vehicleBrand}}, ano 2024.');
  });
});
