import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { DefaultPageLayout } from '../../components/layout/default-page-layout/default-page-layout';
import { ApiErrorService } from '../../services/api-error.service';
import {
  ChargeLeadDays,
  DriverNotificationPrefs,
  DriverPreferencesService,
} from '../../services/driver-preferences.service';
import { NotificationService } from '../../services/notification.service';
import { resolveRovingKey } from '../../components/roving-focus/roving-focus';

type PrefKey = Exclude<keyof DriverNotificationPrefs, 'chargeLeadDays'>;

interface PrefRow {
  key: PrefKey;
  label: string;
  hint: string;
}

/** As cinco linhas do protótipo (`Motorista Configuracoes.dc.html`), na ordem dele. */
export const DRIVER_PREF_ROWS: readonly PrefRow[] = [
  {
    key: 'chargeDueSoon',
    label: 'Cobranças perto do vencimento',
    hint: 'Aviso com o valor e o Pix para pagar.',
  },
  { key: 'chargeOverdue', label: 'Cobrança atrasada', hint: 'Para você não acumular multa e juros.' },
  {
    key: 'inspectionRequested',
    label: 'Vistoria pedida pela locadora',
    hint: 'Quando uma nova vistoria for solicitada.',
  },
  { key: 'inspectionResult', label: 'Resultado da vistoria', hint: 'Quando a locadora aprovar ou recusar.' },
  { key: 'newFine', label: 'Multas do veículo', hint: 'Quando chegar uma multa nova.' },
];

export const CHARGE_LEAD_OPTIONS: readonly ChargeLeadDays[] = [1, 2, 3];

/**
 * Configurações do MOTORISTA: os avisos que ele recebe no celular e com quanta antecedência
 * o avisamos de uma cobrança.
 *
 * Fora daqui, de propósito: conexões de apps (Uber/99 estão fora do escopo — README do handoff)
 * e a meta diária, que tem tela própria (Metas) e um único dono do `/driver/goals`. O protótipo
 * também não as desenha.
 *
 * Cada toque grava na hora (sem botão Salvar, como no protótipo). Se a gravação falha, o
 * controle volta ao valor anterior e um toast diz por quê.
 */
@Component({
  selector: 'app-driver-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertBanner, DefaultPageLayout],
  templateUrl: './driver-settings.html',
})
export class DriverSettings implements OnInit {
  private readonly prefsService = inject(DriverPreferencesService);
  private readonly notifications = inject(NotificationService);
  private readonly apiErrors = inject(ApiErrorService);

  protected readonly rows = DRIVER_PREF_ROWS;
  protected readonly leadOptions = CHARGE_LEAD_OPTIONS;

  protected readonly prefs = signal<DriverNotificationPrefs | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);

  /**
   * O último estado que o SERVIDOR confirmou (carga ou gravação bem-sucedida). É para ele que
   * a tela volta quando uma gravação falha — não para o "anterior" da chamada, que pode ser
   * uma escolha otimista ainda não gravada.
   */
  private confirmed: DriverNotificationPrefs | null = null;

  protected readonly leadDays = computed(() => this.prefs()?.chargeLeadDays ?? null);

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.prefsService.get().subscribe({
      next: (prefs) => {
        this.confirmed = prefs;
        this.prefs.set(prefs);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.loadError.set(
          this.apiErrors.messageFor(err, 'Não foi possível carregar suas configurações.'),
        );
      },
    });
  }

  protected isOn(key: PrefKey): boolean {
    return this.prefs()?.[key] ?? false;
  }

  protected leadLabel(days: ChargeLeadDays): string {
    return days === 1 ? '1 dia' : `${days} dias`;
  }

  /** Setas, Home e End movem o foco no grupo de antecedência; Enter/Espaço escolhem (nativo). */
  protected onLeadKeydown(event: KeyboardEvent, index: number): void {
    const action = resolveRovingKey(event.key, index, this.leadOptions.length);
    if (action?.kind !== 'move') return;
    event.preventDefault();
    const group = (event.currentTarget as HTMLElement | null)?.parentElement;
    const target = group?.querySelectorAll<HTMLElement>('[role="radio"]')[action.index];
    target?.focus();
  }

  protected toggle(key: PrefKey): void {
    const current = this.prefs();
    if (!current || this.saving()) return;
    const turningOn = !current[key];
    this.persist({ ...current, [key]: turningOn }, turningOn ? 'Aviso ligado.' : 'Aviso desligado.');
  }

  protected pickLead(days: ChargeLeadDays): void {
    const current = this.prefs();
    if (!current || this.saving() || current.chargeLeadDays === days) return;
    this.persist({ ...current, chargeLeadDays: days }, 'Antecedência salva.');
  }

  /**
   * Mostra a escolha na hora e grava o objeto INTEIRO. Uma gravação por vez: enquanto
   * `saving()`, os controles ficam `aria-disabled` (não `disabled`, que tiraria o foco de quem
   * usa teclado) e os handlers recusam outro toque — dois PUTs
   * em voo com o objeto inteiro poderiam gravar no servidor uma escolha que a tela desfez, ou
   * chegar fora de ordem. Se o servidor recusar, a tela volta ao último estado CONFIRMADO.
   */
  private persist(next: DriverNotificationPrefs, successMessage: string): void {
    this.prefs.set(next);
    this.saving.set(true);
    this.prefsService.update(next).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.confirmed = saved;
        this.prefs.set(saved);
        this.notifications.success(successMessage);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.prefs.set(this.confirmed);
        this.notifications.error(
          this.apiErrors.messageFor(err, 'Não foi possível salvar. Tente novamente.'),
        );
      },
    });
  }
}
