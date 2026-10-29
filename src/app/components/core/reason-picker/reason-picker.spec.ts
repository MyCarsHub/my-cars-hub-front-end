import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReasonOption, ReasonPicker } from './reason-picker';

const OPTIONS: ReasonOption[] = [
  { value: 'A', label: 'Opção A', hint: 'dica' },
  { value: 'B', label: 'Opção B' },
];

@Component({
  imports: [ReasonPicker],
  template: `<app-reason-picker [options]="options" [showNote]="showNote()" [(reason)]="reason" [(note)]="note" />`,
})
class Host {
  readonly options = OPTIONS;
  readonly showNote = signal(true);
  readonly reason = signal<string | null>(null);
  readonly note = signal('');
}

describe('ReasonPicker', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [Host] });
  });

  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }

  it('rádios nativos do mesmo grupo; escolher atualiza o motivo do pai', () => {
    const fixture = render();
    const radios = fixture.nativeElement.querySelectorAll('input[type="radio"]') as NodeListOf<HTMLInputElement>;

    expect(radios.length).toBe(2);
    expect(radios[0].name).toBe(radios[1].name);
    radios[1].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.reason()).toBe('B');
    expect(radios[1].checked).toBe(true);
  });

  it('a observação vai para o pai e o campo tem 16px (text-base)', () => {
    const fixture = render();
    const note = fixture.nativeElement.querySelector('[data-testid="reason-note"]') as HTMLTextAreaElement;

    expect(note.className).toContain('text-base');
    note.value = 'pedido por telefone';
    note.dispatchEvent(new Event('input'));

    expect(fixture.componentInstance.note()).toBe('pedido por telefone');
  });

  it('sem observação quando showNote=false', () => {
    const fixture = render();
    fixture.componentInstance.showNote.set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="reason-note"]')).toBeNull();
  });
});
