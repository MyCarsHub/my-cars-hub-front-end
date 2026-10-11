import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { MembersSheet } from './members-sheet';

@Component({
  imports: [MembersSheet],
  template: `
    <app-members-sheet
      [open]="true"
      title="Titulo"
      [size]="size()"
      [scrim]="scrim()"
    >
      <p>Corpo</p>
      <div sheetFooter data-footer>Rodape</div>
    </app-members-sheet>
  `,
})
class Host {
  readonly size = signal<'md' | 'lg' | 'xl'>('md');
  readonly scrim = signal<'default' | 'strong'>('default');
}

/**
 * `MembersSheet` e o casco das folhas de Membros — e, desde as vistorias v2, do dialogo de
 * agendamento e do visualizador de fotos. A largura e o fundo sao as unicas coisas que esses
 * usos pedem diferentes; o resto (foco preso, Esc, trava de rolagem) e o mesmo contrato.
 */
describe('MembersSheet — largura e fundo', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  }

  const panel = (el: HTMLElement) => el.querySelector<HTMLElement>('[role="dialog"] > div')!;
  const scrim = (el: HTMLElement) => el.querySelector<HTMLElement>('[aria-hidden="true"]')!;

  it('o padrao e a largura das folhas de membros e o fundo de 40%', () => {
    const el = render().nativeElement as HTMLElement;

    expect(panel(el).className).toContain('sm:max-w-md');
    expect(scrim(el).className).toContain('bg-black/40');
  });

  it('lg e a caixa de 520px do agendamento; xl e a de 560px do visualizador', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.size.set('lg');
    fixture.detectChanges();
    expect(panel(el).className).toContain('sm:max-w-[520px]');
    expect(panel(el).className).not.toContain('sm:max-w-md');

    fixture.componentInstance.size.set('xl');
    fixture.detectChanges();
    expect(panel(el).className).toContain('sm:max-w-[560px]');
  });

  it('o fundo forte escurece a 70% sem trocar o resto', () => {
    const fixture = render();
    const el = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.scrim.set('strong');
    fixture.detectChanges();

    expect(scrim(el).className).toContain('bg-black/70');
    expect(scrim(el).className).not.toContain('bg-black/40');
  });

  it('em qualquer largura a folha e a largura toda no celular', () => {
    const el = render().nativeElement as HTMLElement;

    expect(panel(el).className).toContain('w-full');
    expect(panel(el).className).toContain('rounded-t-2xl');
  });
});
