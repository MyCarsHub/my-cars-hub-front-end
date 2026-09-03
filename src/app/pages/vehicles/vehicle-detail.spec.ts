import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VehicleDetail } from './vehicle-detail';
import { ApiErrorService } from '../../services/api-error.service';
import { flatErrorMessage, parseApiError } from '../../services/api-error';
import { NotificationService } from '../../services/notification.service';
import { VehiclesService } from '../../services/vehicles.service';
import { ExternalNavigationService } from '../../services/external-navigation.service';
import type { Vehicle, VehicleSale } from '../../types/vehicle.types';

/**
 * Venda de veículo na tela do detalhe (FEAT-0072).
 *
 * O gesto passa pelo DOM: clique real no botão, digitação real nos campos do
 * diálogo. As três garantias que este arquivo existe para travar:
 *
 *  1. o valor sai em CENTAVOS (o backend usa `*_cents`; mandar reais gravaria
 *     uma venda cem vezes menor, sem erro nenhum);
 *  2. veículo VENDIDO é somente-leitura — as ações de operação ficam
 *     DESABILITADAS e explicadas, nunca escondidas;
 *  3. o 409 de desfazer venda vira mensagem com SAÍDA (a vaga do plano foi
 *     reocupada), não um "não foi possível" genérico.
 */
describe('VehicleDetail — venda (FEAT-0072)', () => {
  const VEHICLE_ID = 'veh-1';

  const baseVehicle: Vehicle = {
    id: VEHICLE_ID,
    companyId: 'co-1',
    plate: 'ABC1D23',
    type: 'CAR',
    brand: 'Fiat',
    model: 'Argo',
    yearManufacture: 2022,
    yearModel: 2022,
    chassis: null,
    hodometer: 10_000,
    licensingExpiration: null,
    renavam: null,
    color: null,
    purchaseDate: null,
    purchasePrice: null,
    ipvaAmount: null,
    ipvaDueDate: null,
    ipvaStatus: null,
    ipvaExpired: false,
    status: 'AVAILABLE',
    fuel: null,
    activeFinancing: null,
    sale: null,
    createdDate: '2026-01-10T12:00:00',
    modifyDate: null,
  };

  const sale: VehicleSale = {
    id: 'sale-1',
    buyerName: 'Maria Compradora',
    saleDate: '2026-08-20',
    saleValueCents: 4_500_000,
    createdDate: '2026-08-20T10:00:00',
  };

  const soldVehicle: Vehicle = { ...baseVehicle, sale };

  let getOne: ReturnType<typeof vi.fn>;
  let sell: ReturnType<typeof vi.fn>;
  let undoSale: ReturnType<typeof vi.fn>;
  let updateStatus: ReturnType<typeof vi.fn>;
  let successToast: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<VehicleDetail>;

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return (host().textContent ?? '').replace(/\s+/g, ' ');
  }

  function buttonByText(label: string): HTMLButtonElement | undefined {
    return Array.from(host().querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').trim().startsWith(label),
    );
  }

  function requireButton(label: string): HTMLButtonElement {
    const btn = buttonByText(label);
    if (!btn) throw new Error(`o botão "${label}" não está na tela`);
    return btn;
  }

  function typeInto(selector: string, value: string): void {
    const input = host().querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`campo ${selector} não está na tela`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /**
   * Clica em CONFIRMAR do diálogo de desfazer venda — identificado pelo texto
   * da mensagem, não pela posição: a tela tem três diálogos.
   */
  function confirmUndoInDialog(): void {
    const dialog = Array.from(host().querySelectorAll('app-confirm-dialog')).find((d) =>
      (d.textContent ?? '').includes('volta para a frota'),
    );
    if (!dialog) throw new Error('o diálogo de desfazer venda não está aberto');
    const btn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Desfazer venda'),
    );
    if (!btn) throw new Error('o diálogo não tem o botão de confirmar');
    btn.click();
    fixture.detectChanges();
  }

  /** Abre o diálogo de venda pelo botão real do cabeçalho. */
  function openSellDialog(): void {
    requireButton('Vender').click();
    fixture.detectChanges();
  }

  async function setup(vehicle: Vehicle = baseVehicle): Promise<void> {
    getOne = vi.fn(() => of(vehicle));
    sell = vi.fn(() => of({ ...vehicle, sale }));
    undoSale = vi.fn(() => of({ ...vehicle, sale: null }));
    updateStatus = vi.fn(() => of(vehicle));
    successToast = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => VEHICLE_ID } } } },
        {
          provide: VehiclesService,
          useValue: {
            getOne,
            sell,
            undoSale,
            updateStatus,
            remove: vi.fn(),
            listDocuments: vi.fn(() => of([])),
          },
        },
        { provide: ExternalNavigationService, useValue: { openPendingTab: vi.fn() } },
        {
          provide: NotificationService,
          useValue: { success: successToast, error: vi.fn(), info: vi.fn(), warning: vi.fn() },
        },
        {
          provide: ApiErrorService,
          useValue: {
            claim: vi.fn(),
            // Pipeline REAL de parsing: sem ele o teste do 409 provaria apenas
            // que o mock devolve o que mandaram nele.
            messageFor: vi.fn((e: unknown, fallback?: string) =>
              flatErrorMessage(parseApiError(e), fallback),
            ),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(VehicleDetail);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // ------------------------------------------------------------ vender

  it('abre o diálogo de FORMULÁRIO pelo botão Vender, com os três campos', async () => {
    await setup();

    expect(host().querySelector('#sell-vehicle-buyer')).toBeNull();

    openSellDialog();

    expect(host().querySelector('[role="dialog"]')).not.toBeNull();
    expect(host().querySelector('#sell-vehicle-buyer')).not.toBeNull();
    expect(host().querySelector('#sell-vehicle-date')).not.toBeNull();
    expect(host().querySelector('#sell-vehicle-amount')).not.toBeNull();
    expect(text()).toContain('Vender veículo');
    // Contexto do que está sendo vendido, como nos diálogos irmãos.
    expect(text()).toContain('ABC-1D23');
  });

  /**
   * O ponto mais caro de errar: dinheiro vai em CENTAVOS. "45.000,00" na
   * gramática pt-BR são 4.500.000 centavos — não 45000, nem 45.
   */
  it('envia o valor em CENTAVOS a partir do texto pt-BR digitado', async () => {
    await setup();
    openSellDialog();

    typeInto('#sell-vehicle-buyer', 'Maria Compradora');
    typeInto('#sell-vehicle-date', '2026-08-20');
    typeInto('#sell-vehicle-amount', '45.000,00');
    requireButton('Registrar venda').click();
    fixture.detectChanges();

    expect(sell).toHaveBeenCalledTimes(1);
    expect(sell).toHaveBeenCalledWith(VEHICLE_ID, {
      buyerName: 'Maria Compradora',
      saleDate: '2026-08-20',
      saleValueCents: 4_500_000,
    });
    expect(successToast).toHaveBeenCalled();
  });

  it('não chama a API com campo vazio — mostra o erro inline e mantém o diálogo', async () => {
    await setup();
    openSellDialog();

    // Só o comprador; data e valor em branco.
    typeInto('#sell-vehicle-buyer', 'Maria Compradora');
    requireButton('Registrar venda').click();
    fixture.detectChanges();

    expect(sell).not.toHaveBeenCalled();
    expect(text()).toContain('Informe a data da venda.');
    expect(text()).toContain('Informe o valor da venda.');
    expect(host().querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('recusa valor zero e data no futuro, sem ir ao servidor', async () => {
    await setup();
    openSellDialog();

    typeInto('#sell-vehicle-buyer', 'Maria Compradora');
    typeInto('#sell-vehicle-date', '2099-01-01');
    typeInto('#sell-vehicle-amount', '0');
    requireButton('Registrar venda').click();
    fixture.detectChanges();

    expect(sell).not.toHaveBeenCalled();
    expect(text()).toContain('A venda não pode ser no futuro.');
    expect(text()).toContain('Informe um valor maior que zero');
  });

  it('recusa do servidor fica DENTRO do diálogo, com o formulário preservado', async () => {
    await setup();
    sell.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: 'Veículo possui aluguel ativo.' },
          }),
      ),
    );
    openSellDialog();

    typeInto('#sell-vehicle-buyer', 'Maria Compradora');
    typeInto('#sell-vehicle-date', '2026-08-20');
    typeInto('#sell-vehicle-amount', '45.000,00');
    requireButton('Registrar venda').click();
    fixture.detectChanges();

    expect(text()).toContain('Veículo possui aluguel ativo.');
    expect(host().querySelector('[role="dialog"]')).not.toBeNull();
    const buyer = host().querySelector<HTMLInputElement>('#sell-vehicle-buyer');
    expect(buyer?.value).toBe('Maria Compradora');
  });

  // -------------------------------------------------- vendido: só leitura

  it('veículo vendido mostra comprador, data e valor no cabeçalho', async () => {
    await setup(soldVehicle);

    const banner = host().querySelector('[data-sold-banner]');
    expect(banner).not.toBeNull();
    const bannerText = (banner?.textContent ?? '').replace(/\s+/g, ' ');
    expect(bannerText).toContain('Veículo vendido em 20/08/2026');
    expect(bannerText).toContain('Maria Compradora');
    expect(bannerText).toContain('45.000,00');
    // E a marcação no cabeçalho, ao lado dos chips de status/tipo.
    expect(text()).toContain('Vendido');
  });

  /**
   * DESABILITADAS, não escondidas: o operador precisa entender por que a tela
   * não responde. O motivo viaja no `title` de cada controle travado.
   */
  it('veículo vendido desabilita as ações de operação, explicando o motivo', async () => {
    await setup({ ...soldVehicle, status: 'INACTIVE' });

    const disponivel = requireButton('Marcar disponível');
    expect(disponivel.disabled).toBe(true);
    expect(disponivel.getAttribute('title')).toContain('Veículo vendido em 20/08/2026');

    const excluir = host().querySelector<HTMLButtonElement>('button[aria-label="Excluir"]');
    expect(excluir?.disabled).toBe(true);
    expect(excluir?.getAttribute('title')).toContain('Veículo vendido em 20/08/2026');

    // Editar continua visível, mas inerte e anunciado como tal.
    const editar = host().querySelector('a[aria-disabled="true"]');
    expect(editar).not.toBeNull();

    // E o botão de vender deu lugar ao de desfazer.
    expect(buttonByText('Vender')).toBeUndefined();
    expect(buttonByText('Desfazer venda')).toBeDefined();
  });

  /**
   * Clicar num botão `disabled` prova o TEMPLATE, não o componente. Aqui a
   * chamada é direta: se a guarda de `transitionStatus` sumir, este teste cai
   * mesmo com o atributo `disabled` intacto — que é o furo que o botão
   * desabilitado esconderia.
   */
  it('transitionStatus() recusa no COMPONENTE quando o veículo está vendido', async () => {
    await setup({ ...soldVehicle, status: 'INACTIVE' });

    const api = fixture.componentInstance as unknown as {
      transitionStatus: (t: 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE') => void;
    };
    api.transitionStatus('AVAILABLE');
    fixture.detectChanges();

    expect(updateStatus).not.toHaveBeenCalled();

    // Controle positivo: sem venda, a MESMA chamada passa.
    await setup({ ...baseVehicle, status: 'INACTIVE' });
    (
      fixture.componentInstance as unknown as {
        transitionStatus: (t: 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE') => void;
      }
    ).transitionStatus('AVAILABLE');
    fixture.detectChanges();
    expect(updateStatus).toHaveBeenCalledWith(VEHICLE_ID, 'AVAILABLE');
  });

  // O template também trava — as duas metades da regra, cada uma no seu teste.
  it('o botão de transição fica desabilitado no veículo vendido', async () => {
    await setup({ ...soldVehicle, status: 'INACTIVE' });

    expect(requireButton('Marcar disponível').disabled).toBe(true);
  });

  // ------------------------------------------------------ desfazer venda

  it('desfaz a venda depois da confirmação e devolve o veículo à frota', async () => {
    await setup(soldVehicle);

    requireButton('Desfazer venda').click();
    fixture.detectChanges();
    expect(undoSale).not.toHaveBeenCalled();

    // Confirmação real, no diálogo real.
    confirmUndoInDialog();

    expect(undoSale).toHaveBeenCalledWith(VEHICLE_ID, expect.any(String));
    expect(host().querySelector('[data-sold-banner]')).toBeNull();
    expect(successToast).toHaveBeenCalledWith('Venda desfeita. O veículo voltou para a frota.');
  });

  it('erro genérico no desfazer vira mensagem padrão no banner inline', async () => {
    await setup(soldVehicle);
    undoSale.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server Error' })),
    );

    requireButton('Desfazer venda').click();
    fixture.detectChanges();
    confirmUndoInDialog();

    const banner = host().querySelector('app-alert-banner');
    expect(banner?.textContent).toContain('Não foi possível desfazer a venda.');
    // Nada da explicação de capacidade: essa é exclusiva do 409.
    expect(text()).not.toContain('vaga deste veículo no plano');
    expect(host().querySelector('[data-sold-banner]')).not.toBeNull();
  });

  /**
   * O 409 aqui é REGRA, não falha: a vaga do plano foi reocupada enquanto o
   * carro estava vendido. A mensagem tem de dizer isso e dar as duas saídas —
   * um "não foi possível" deixaria o operador sem ação nenhuma.
   */
  it('traduz o 409 de capacidade em uma mensagem com saída', async () => {
    await setup(soldVehicle);
    undoSale.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Plan vehicle limit reached.' },
          }),
      ),
    );

    requireButton('Desfazer venda').click();
    fixture.detectChanges();
    confirmUndoInDialog();

    const shown = text();
    expect(shown).toContain('a vaga deste veículo no plano já foi ocupada');
    expect(shown).toContain('Libere uma vaga');
    expect(shown).toContain('upgrade do plano');
    // O veículo continua vendido: nada mudou no servidor.
    expect(host().querySelector('[data-sold-banner]')).not.toBeNull();
  });
});
