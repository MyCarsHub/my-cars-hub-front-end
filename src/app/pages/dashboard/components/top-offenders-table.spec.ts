import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { OffenderRow, TopOffendersTable } from './top-offenders-table';

/**
 * Cobre o padrão de listagem dos cards "Top ofensores" (mesmo design de Veículos/Multas):
 *  - vazio → mensagem "Sem multas no período.";
 *  - mobile → cards <article> focáveis; desktop → tabela com cabeçalho padrão;
 *  - clique e Enter emitem rowClick nos dois layouts.
 */
describe('TopOffendersTable', () => {
    const rows: OffenderRow[] = [
        { id: 'v-1', title: 'ABC1D23', subtitle: 'Fiat Argo', count: 3, totalAmountCents: 45000 },
        { id: 'v-2', title: 'XYZ9K88', subtitle: 'VW Gol', count: 1, totalAmountCents: 19500 },
    ];

    beforeEach(() => {
        TestBed.configureTestingModule({ imports: [TopOffendersTable] });
    });

    function create(data: OffenderRow[]) {
        const fixture = TestBed.createComponent(TopOffendersTable);
        fixture.componentRef.setInput('rows', data);
        fixture.detectChanges();
        return fixture;
    }

    it('mostra o estado vazio quando não há linhas', () => {
        const fixture = create([]);
        const host = fixture.nativeElement as HTMLElement;
        expect(host.textContent).toContain('Sem multas no período.');
        expect(host.querySelector('table')).toBeNull();
    });

    it('renderiza cards mobile focáveis e tabela desktop com o cabeçalho padrão', () => {
        const fixture = create(rows);
        const host = fixture.nativeElement as HTMLElement;

        const cards = host.querySelectorAll('article');
        expect(cards.length).toBe(2);
        cards.forEach((card) => {
            expect(card.getAttribute('tabindex')).toBe('0');
            // Card clicável se anuncia como botão pro leitor de tela.
            expect(card.getAttribute('role')).toBe('button');
        });

        // Contraste AA: micro-labels dos cards usam neutral-500 (4,74:1), nunca neutral-400.
        expect(host.querySelector('.text-neutral-400')).toBeNull();

        const headers = Array.from(host.querySelectorAll('th')).map((th) => th.textContent?.trim());
        expect(headers).toEqual(['Item', 'Detalhe', 'Multas', 'Total']);

        const bodyRows = host.querySelectorAll('tbody tr');
        expect(bodyRows.length).toBe(2);
        expect(bodyRows[0].textContent).toContain('ABC1D23');
        expect(bodyRows[0].textContent).toContain('Fiat Argo');
    });

    it('emite rowClick no clique e no Enter, em card e em linha da tabela', () => {
        const fixture = create(rows);
        const host = fixture.nativeElement as HTMLElement;
        const emitted = vi.fn();
        fixture.componentInstance.rowClick.subscribe(emitted);

        host.querySelectorAll('article')[0].dispatchEvent(new MouseEvent('click'));
        expect(emitted).toHaveBeenLastCalledWith(rows[0]);

        const tableRows = host.querySelectorAll('tbody tr');
        tableRows[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(emitted).toHaveBeenLastCalledWith(rows[1]);

        expect(emitted).toHaveBeenCalledTimes(2);
    });

    it('emite rowClick no Espaço (com preventDefault, sem rolar a página) em card e linha', () => {
        const fixture = create(rows);
        const host = fixture.nativeElement as HTMLElement;
        const emitted = vi.fn();
        fixture.componentInstance.rowClick.subscribe(emitted);

        const cardSpace = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
        host.querySelectorAll('article')[0].dispatchEvent(cardSpace);
        expect(emitted).toHaveBeenLastCalledWith(rows[0]);
        expect(cardSpace.defaultPrevented).toBe(true);

        const rowSpace = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
        host.querySelectorAll('tbody tr')[1].dispatchEvent(rowSpace);
        expect(emitted).toHaveBeenLastCalledWith(rows[1]);
        expect(rowSpace.defaultPrevented).toBe(true);

        expect(emitted).toHaveBeenCalledTimes(2);
    });
});
