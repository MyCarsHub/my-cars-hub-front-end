import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ContractExistingFields } from './contract-existing-fields';

const FIELDS = [
  { field: 'rentalId', label: 'Número do contrato' },
  { field: 'driverName', label: 'Nome do motorista' },
  { field: 'driverCpf', label: 'CPF do motorista' },
  { field: 'contractDate', label: 'Data do contrato' },
];

describe('ContractExistingFields', () => {
  let fixture: ComponentFixture<ContractExistingFields>;
  let host: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(ContractExistingFields);
    host = fixture.nativeElement;
  });

  const show = (fields: typeof FIELDS) => {
    fixture.componentRef.setInput('fields', fields);
    fixture.detectChanges();
  };
  const toggle = () => host.querySelector('button')!;

  it('sem campos não desenha nada', () => {
    show([]);

    expect(host.textContent?.trim()).toBe('');
    expect(host.querySelector('button')).toBeNull();
  });

  it('diz quantos são e dá uma amostra, sem abrir', () => {
    show(FIELDS);

    expect(toggle().textContent).toContain('4 dados já estão no contrato');
    expect(toggle().textContent).toContain('Número do contrato, Nome do motorista, CPF do motorista e mais 1');
    expect(host.querySelector('ul')).toBeNull();
  });

  it('um campo só fica no singular, sem «e mais»', () => {
    show(FIELDS.slice(0, 1));

    expect(toggle().textContent).toContain('1 dado já está no contrato');
    expect(toggle().textContent).not.toContain('e mais');
  });

  it('abre a lista com os rótulos, sem a chave técnica', () => {
    show(FIELDS);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');

    toggle().click();
    fixture.detectChanges();

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const items = Array.from(host.querySelectorAll('li')).map((li) => li.textContent?.trim());
    expect(items).toEqual(FIELDS.map((f) => f.label));
    expect(host.textContent).not.toMatch(/rentalId|driverName/);
    expect(host.querySelector('ul')?.id).toBe(toggle().getAttribute('aria-controls'));
  });

  it('dois na mesma tela não dividem o mesmo id', () => {
    const other = TestBed.createComponent(ContractExistingFields);
    other.componentRef.setInput('fields', FIELDS);
    other.detectChanges();
    show(FIELDS);

    expect(other.nativeElement.querySelector('button').getAttribute('aria-controls'))
      .not.toBe(toggle().getAttribute('aria-controls'));
  });
});
