import type { ComponentFixture } from '@angular/core/testing';

/**
 * Specs do detalhe da empresa (rodada de 18/11/2026): as ações moram no ⋮ do topo e três blocos
 * (assinatura, integração, cadastro, vendas) abrem recolhidos. Este ajudante abre tudo, para os
 * specs lerem o que existia antes sem repetir os cliques.
 */
export function openDetailMenu(fixture: ComponentFixture<unknown>): void {
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const trigger = host.querySelector<HTMLButtonElement>('[data-testid="detail-actions"] button[aria-haspopup="menu"]');
  if (trigger && trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  fixture.detectChanges();
}

/** Expande os blocos recolhidos e o "ver tudo" da operação. */
export function expandDetail(fixture: ComponentFixture<unknown>): void {
  const host = fixture.nativeElement as HTMLElement;
  host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Expandir "]').forEach((b) => b.click());
  const ops = host.querySelector<HTMLButtonElement>('[data-testid="operations-toggle"]');
  if (ops && ops.getAttribute('aria-expanded') !== 'true') ops.click();
  fixture.detectChanges();
}

/** Tudo aberto: blocos expandidos e o ⋮ do topo aberto. */
export function revealDetail(fixture: ComponentFixture<unknown>): void {
  expandDetail(fixture);
  openDetailMenu(fixture);
}
