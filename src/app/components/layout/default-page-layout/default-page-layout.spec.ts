import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DefaultPageLayout } from './default-page-layout';

@Component({
  imports: [DefaultPageLayout],
  template: `
    <app-default-page-layout title="Detalhes" description="Subtitulo.">
      <a pageBack href="/voltar">Voltar</a>
      <span pageBadge>Aprovada</span>
      <p id="corpo">Corpo</p>
    </app-default-page-layout>
  `,
})
class SlotsHost {}

@Component({
  imports: [DefaultPageLayout],
  template: `
    <app-default-page-layout title="Sem slots" description="Nada ao lado.">
      <p id="corpo">Corpo</p>
    </app-default-page-layout>
  `,
})
class PlainHost {}

describe('DefaultPageLayout', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DefaultPageLayout],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(DefaultPageLayout);
    expect(fixture.componentInstance).toBeTruthy();
  });

  /**
   * Os dois slots OPCIONAIS da tela de detalhes: o voltar ACIMA do titulo e o chip de
   * situacao AO LADO dele. O conteudo sem seletor continua indo para o corpo.
   */
  describe('slots opcionais', () => {
    it('o voltar fica acima do titulo e o chip no mesmo bloco dele', () => {
      const fixture = TestBed.createComponent(SlotsHost);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const header = host.querySelector('header')!;
      const heading = header.querySelector('h1')!;
      const back = header.querySelector('[pageback]')!;
      const badge = header.querySelector('[pagebadge]')!;

      expect(back).not.toBeNull();
      // O voltar vem ANTES do bloco do titulo, e o chip e irmao do h1.
      expect(
        back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(badge.parentElement).toBe(heading.parentElement);
    });

    it('o corpo sem seletor segue fora do cabecalho', () => {
      const fixture = TestBed.createComponent(SlotsHost);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('header')?.querySelector('#corpo')).toBeNull();
      expect(host.querySelector('#corpo')).not.toBeNull();
    });

    it('sem slots, o cabecalho e so titulo e descricao', () => {
      const fixture = TestBed.createComponent(PlainHost);
      fixture.detectChanges();
      const header = (fixture.nativeElement as HTMLElement).querySelector('header')!;

      expect(header.querySelector('h1')?.textContent?.trim()).toBe('Sem slots');
      expect(header.querySelectorAll('a, span').length).toBe(0);
      expect(header.textContent).toContain('Nada ao lado.');
    });
  });
});
