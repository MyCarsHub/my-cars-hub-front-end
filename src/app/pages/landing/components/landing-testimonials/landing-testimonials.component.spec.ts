import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { LandingTestimonialsComponent } from './landing-testimonials.component';
import { COMMUNITY_WHATSAPP_URL } from '../../landing-community';

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

/**
 * Esta seção já publicou seis depoimentos com nome, cidade e tamanho de frota que NÃO
 * eram de clientes reais. Os testes abaixo existem para que voltar a esse estado quebre
 * a suíte em vez de passar despercebido num review de template.
 */
describe('LandingTestimonialsComponent', () => {
  let text: string;
  let host: HTMLElement;

  beforeEach(async () => {
    (
      globalThis as unknown as { IntersectionObserver: typeof IntersectionObserverStub }
    ).IntersectionObserver = IntersectionObserverStub;
    await TestBed.configureTestingModule({
      imports: [LandingTestimonialsComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(LandingTestimonialsComponent);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    text = host.textContent ?? '';
  });

  it('anuncia a construção em público em vez de prova social inventada', () => {
    expect(text).toContain('Construído em público');
    expect(text).toContain('Comunidade dos Locadores');
  });

  /**
   * O cabeçalho já narrava ao visitante que a seção "não tem depoimento pra mostrar" e que,
   * "em vez de inventar um", mostrava o processo. Decisão do dono do produto: a página não
   * se explica nem confessa — ela convida. A regra que fica é mais forte que a confissão
   * era: o convite continua obrigatório e o registro defensivo fica proibido na copy.
   */
  describe('o cabeçalho convida em vez de se justificar', () => {
    it('mantém o convite e o fato de ser começo de produto', () => {
      expect(text).toMatch(/está no começo/i);
      expect(text).toMatch(/entra na conversa/i);
    });

    it.each([
      ['inventar', /\binventar\b/i],
      ['não tem depoimento', /não tem depoimento/i],
      ['em vez de', /em vez de/i],
    ])('não usa registro defensivo na copy (%s)', (_label, forbidden) => {
      expect(text).not.toMatch(forbidden);
    });
  });

  it('não renderiza nenhum depoimento — sem citação, sem nome, sem avatar de pessoa', () => {
    expect(host.querySelector('blockquote')).toBeNull();
    expect(host.querySelector('figcaption')).toBeNull();

    for (const name of ['André M.', 'Mariana S.', 'Felipe L.', 'Beatriz R.', 'Lucas C.', 'Camila B.']) {
      expect(text).not.toContain(name);
    }
  });

  /**
   * Dois riscos opostos no mesmo lugar: publicar um `href` vazio/inventado, e — o que
   * já aconteceu — publicar um marcador "Link da comunidade pendente" numa página que
   * o visitante lê. Com a constante vazia o CTA sai em SILÊNCIO: nenhum link e nenhum
   * texto de rascunho. Se alguém reintroduzir o aviso, este teste quebra.
   */
  it('só publica o link da comunidade quando existe uma URL real', () => {
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('a[href]'));

    if (COMMUNITY_WHATSAPP_URL === '') {
      expect(links).toEqual([]);
      expect(text).not.toContain('pendente');
      expect(text).not.toContain('landing-community.ts');
      // A seção continua de pé — some o CTA, não o conteúdo.
      expect(text).toContain('Comunidade dos Locadores');
    } else {
      expect(links.map((a) => a.getAttribute('href'))).toContain(COMMUNITY_WHATSAPP_URL);
      for (const link of links) {
        expect(link.getAttribute('rel')).toContain('noopener');
      }
    }
  });
});
