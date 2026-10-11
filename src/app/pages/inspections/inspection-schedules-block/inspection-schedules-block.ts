import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Observable, map, startWith, switchMap, tap } from 'rxjs';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import {
  FilterChipGroup,
  FilterChipOption,
} from '../../../components/filter-chip-group/filter-chip-group';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { ApiErrorService } from '../../../services/api-error.service';
import { InspectionScheduleService } from '../../../services/inspection-schedule.service';
import { NotificationService } from '../../../services/notification.service';
import {
  INSPECTION_FREQUENCY_OPTIONS,
  InspectionFrequency,
  InspectionScheduleResponse,
  inspectionFrequencyLabel,
  isFleetSchedule,
} from '../../../types/inspection-schedule.types';
import { todayInBusinessTz } from '../../../utils/business-clock';
import { MembersSheet } from '../../company-settings/members/members-sheet';
import { formatDate, pluralize } from '../inspection-view';

type Scope = 'FLEET' | 'ONE';

/** Avisos oferecidos. Um valor que a regra salva ja tem e que nao esteja aqui entra junto. */
const NOTICE_DAYS: readonly number[] = [1, 3, 7];
const DEFAULT_FREQUENCY: InspectionFrequency = 'BIWEEKLY';
const DEFAULT_NOTICE = 3;

/**
 * Amanha, no relogio de NEGOCIO (Brasilia) — nao o do navegador. O backend trata datas como
 * horario de parede de `America/Sao_Paulo`: um operador em Manaus nao pode agendar "para
 * amanha" no dia que, para o servidor, ainda e hoje. Lido no uso, nunca fixado na carga.
 */
function tomorrow(): string {
  const [y, m, d] = todayInBusinessTz().split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** A data escolhida nao pode ser hoje nem passado. Vazio e assunto do `required`. */
function fromTomorrow(control: AbstractControl): ValidationErrors | null {
  const value = control.value as string;
  return value && value < tomorrow() ? { min: { min: tomorrow() } } : null;
}

/**
 * O cartao "Vistorias automaticas" e o dialogo que o configura.
 *
 * ## Configurado UMA vez, editado quando precisar
 *
 * Nao e acao recorrente do dono, entao NAO e botao laranja nem tem destaque: e um cartao
 * neutro com o estado (Ativo / Desligado), a regra em uma frase e UM botao outline
 * ("Editar" ou "Configurar").
 *
 * ## O que o backend aceita, e onde a tela se afasta do desenho
 *
 * O desenho sugere repetir a cada 7/15/30/60/90 dias. O backend aceita SETE frequencias
 * (`InspectionFrequency`) e nenhuma delas e "60 dias". A tela oferece as sete, com o nome
 * que o servidor usa — inventar "60 dias" mandaria um valor que ele recusa.
 *
 * ## Regra da frota nao e `upsert`
 *
 * `POST /inspection-schedules/fleet` responde 400 quando ja existe uma regra vigente. Salvar
 * sobre uma regra existente e portanto DESLIGAR a atual e CRIAR a nova, nessa ordem. Se a
 * criacao falhar depois do desligamento, a tela diz exatamente isso (a regra anterior ficou
 * desligada) e relê o estado em vez de fingir que nada mudou. Um `PUT` que substituisse numa
 * chamada so tiraria essa janela — fica como pedido ao backend.
 *
 * Regra por VEICULO: `POST` ja cria ou substitui, sem passo extra.
 */
@Component({
  selector: 'app-inspection-schedules-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    AlertBanner,
    ConfirmDialog,
    FilterChipGroup,
    FormField,
    FieldControl,
    MembersSheet,
  ],
  templateUrl: './inspection-schedules-block.html',
})
export class InspectionSchedulesBlock implements OnInit {
  /** Placas/modelos para nomear o veiculo — a lista de agendamentos so traz o id. */
  readonly vehicleOptions = input<ReadonlyArray<{ id: string; label: string }>>([]);

  private readonly fb = inject(FormBuilder);
  private readonly schedules = inject(InspectionScheduleService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  private readonly all = signal<InspectionScheduleResponse[]>([]);
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);

  protected readonly open = signal(false);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly confirmingOff = signal(false);
  /** Reavaliado a cada abertura: o minimo do `<input type=date>` e "amanha" DE HOJE. */
  protected readonly minDate = signal(tomorrow());

  protected readonly form = this.fb.group({
    scope: this.fb.nonNullable.control<Scope>('FLEET'),
    vehicleId: this.fb.nonNullable.control('', {
      validators: [
        (c: AbstractControl): ValidationErrors | null =>
          c.parent?.get('scope')?.value === 'ONE' && !c.value ? { required: true } : null,
      ],
    }),
    frequency: this.fb.nonNullable.control<InspectionFrequency>(DEFAULT_FREQUENCY),
    startDate: this.fb.nonNullable.control('', {
      validators: [Validators.required, fromTomorrow],
    }),
    notice: this.fb.nonNullable.control(DEFAULT_NOTICE),
  });

  protected readonly vehicleMessages = { required: 'Selecione o veículo.' };
  protected readonly dateMessages = {
    required: 'Informe a data da primeira vistoria.',
    min: 'Escolha uma data a partir de amanhã.',
  };

  /** Os valores do formulario como signal — `FormControl` nao e reativo para `computed`. */
  protected readonly value = toSignal(
    this.form.valueChanges.pipe(
      startWith(null),
      map(() => this.form.getRawValue()),
    ),
    { initialValue: this.form.getRawValue() },
  );

  protected readonly frequencyChips: ReadonlyArray<FilterChipOption<InspectionFrequency>> =
    INSPECTION_FREQUENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

  protected readonly scopeChips: ReadonlyArray<FilterChipOption<Scope>> = [
    { value: 'FLEET', label: 'Toda a frota' },
    { value: 'ONE', label: 'Um veículo' },
  ];

  protected readonly fleetRule = computed(
    () => this.all().find((s) => isFleetSchedule(s)) ?? null,
  );
  private readonly vehicleRules = computed(() => this.all().filter((s) => !isFleetSchedule(s)));

  protected readonly active = computed(() => this.fleetRule() !== null);

  /** "Toda a frota, a cada 15 dias. Próxima em 25/10/2026, com aviso 3 dias antes." */
  protected readonly summaryText = computed(() => {
    const own = this.vehicleRules().length;
    const ownText =
      own === 0
        ? ''
        : ` ${own} ${own === 1 ? 'veículo com regra própria' : 'veículos com regra própria'}.`;

    const fleet = this.fleetRule();
    if (!fleet) {
      return (
        'Peça as vistorias aos motoristas automaticamente, para todos os veículos, ' +
        'sem precisar lembrar de cada um.' +
        ownText
      );
    }
    const next = formatDate(fleet.nextDueDate);
    const notice = `aviso ${pluralize(fleet.reminderIntervalDays, 'dia', 'dias')} antes`;
    const tail = next ? `Próxima em ${next}, com ${notice}.` : `Com ${notice}.`;
    return `Toda a frota, ${this.phrase(fleet.frequency)}. ${tail}${ownText}`;
  });

  protected readonly dialogTitle = computed(() =>
    this.all().length > 0 ? 'Agendamento automático' : 'Ativar vistorias automáticas',
  );
  protected readonly saveLabel = computed(() =>
    this.fleetRule() ? 'Salvar alterações' : 'Ativar',
  );
  /**
   * O que "Desativar" desliga neste momento, ou `null` quando nao ha o que desligar.
   *
   * O desenho so traz o botao na regra da FROTA. A regra POR VEICULO tambem precisa de uma
   * saida: era a unica tela que a desligava (linha "Desligar" do bloco anterior), e sem ela o
   * dono criaria uma regra de carro e nao teria como tira-la. Entao o botao aparece tambem
   * quando o alvo e um carro que JA tem regra propria.
   */
  protected readonly turnOffTarget = computed<
    { kind: 'FLEET' } | { kind: 'VEHICLE'; vehicleId: string; plate: string } | null
  >(() => {
    const v = this.value();
    if (v.scope === 'FLEET') return this.fleetRule() !== null ? { kind: 'FLEET' } : null;
    const own = v.vehicleId && this.vehicleRules().some((s) => s.vehicleId === v.vehicleId);
    return own
      ? { kind: 'VEHICLE', vehicleId: v.vehicleId, plate: this.plateOf(v.vehicleId) ?? 'veículo' }
      : null;
  });
  protected readonly canTurnOff = computed(() => this.turnOffTarget() !== null);

  protected readonly turnOffMessage = computed(() =>
    this.turnOffTarget()?.kind === 'VEHICLE'
      ? 'O carro deixa de receber os pedidos automáticos e os pedidos pendentes dele são cancelados. ' +
        'Se a frota tiver regra, ela volta a valer para este carro.'
      : 'Os motoristas deixam de receber os pedidos automáticos e os pedidos pendentes da frota são ' +
        'cancelados. Regras próprias de veículos continuam valendo.',
  );

  protected readonly noticeChips = computed<ReadonlyArray<FilterChipOption<number>>>(() => {
    const current = this.value().notice;
    const days = NOTICE_DAYS.includes(current)
      ? NOTICE_DAYS
      : [...NOTICE_DAYS, current].sort((a, b) => a - b);
    return days.map((d) => ({ value: d, label: `${d} ${d === 1 ? 'dia' : 'dias'} antes` }));
  });

  protected readonly isOneVehicle = computed(() => this.value().scope === 'ONE');

  protected readonly scopeHint = computed(() =>
    this.isOneVehicle()
      ? 'Use para um carro que precisa de ritmo diferente do resto da frota.'
      : 'Vale também para carros cadastrados depois.',
  );

  protected readonly preview = computed(() => {
    const v = this.value();
    const where =
      v.scope === 'FLEET'
        ? 'todos os veículos'
        : (this.plateOf(v.vehicleId) ?? 'o veículo escolhido');
    const every = this.phrase(v.frequency);
    const date = formatDate(v.startDate);
    if (!date) return `Vistoria de ${where}, ${every}. Escolha a data da primeira.`;
    return (
      `Vistoria de ${where}, ${every}, a primeira em ${date}. ` +
      `O motorista é avisado ${pluralize(v.notice, 'dia', 'dias')} antes.`
    );
  });

  /** O aviso "Salvar substitui o atual", ou `null` quando nao ha regra para o mesmo alvo. */
  protected readonly replaceNotice = computed<string | null>(() => {
    const v = this.value();
    if (v.scope === 'FLEET') {
      return this.fleetRule()
        ? 'Já existe um agendamento para toda a frota. Salvar substitui o atual.'
        : null;
    }
    if (!v.vehicleId) return null;
    const exists = this.vehicleRules().some((s) => s.vehicleId === v.vehicleId);
    return exists
      ? `Já existe um agendamento para ${this.plateOf(v.vehicleId) ?? 'este veículo'}. Salvar substitui o atual.`
      : null;
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.schedules.listForCompany().subscribe({
      next: (found) => {
        this.all.set((found ?? []).filter((s) => s.active));
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.apiErrors.claim(err);
        this.loading.set(false);
        this.loadFailed.set(true);
      },
    });
  }

  /** Abre o dialogo. Com regra de frota, ja vem preenchido com ela. */
  protected openDialog(): void {
    const fleet = this.fleetRule();
    this.minDate.set(tomorrow());
    this.form.reset(
      fleet
        ? {
            scope: 'FLEET',
            vehicleId: '',
            frequency: fleet.frequency,
            // A proxima ocorrencia, nao a data de inicio: a de inicio ja passou e nao
            // passaria na validacao "a partir de amanha" sem a pessoa tocar nela.
            startDate: fleet.nextDueDate || fleet.startDate || '',
            notice: fleet.reminderIntervalDays || DEFAULT_NOTICE,
          }
        : {
            scope: 'FLEET',
            vehicleId: '',
            frequency: DEFAULT_FREQUENCY,
            startDate: '',
            notice: DEFAULT_NOTICE,
          },
    );
    this.formError.set(null);
    this.open.set(true);
  }

  protected closeDialog(): void {
    if (this.saving()) return;
    this.open.set(false);
    this.confirmingOff.set(false);
  }

  protected setScope(scope: Scope): void {
    this.form.controls.scope.setValue(scope);
    // A obrigatoriedade do veiculo depende do alvo: revalida e, ao sair de "Um veiculo",
    // nao deixa um erro velho preso num campo que nem aparece.
    this.form.controls.vehicleId.updateValueAndValidity();
    this.formError.set(null);
  }

  protected setFrequency(frequency: InspectionFrequency): void {
    this.form.controls.frequency.setValue(frequency);
    this.formError.set(null);
  }

  protected setNotice(days: number): void {
    this.form.controls.notice.setValue(days);
    this.formError.set(null);
  }

  protected save(): void {
    if (this.saving()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    const payload = {
      frequency: v.frequency,
      startDate: v.startDate,
      reminderIntervalDays: v.notice,
    };

    this.saving.set(true);
    this.formError.set(null);

    const replacingFleet = v.scope === 'FLEET' && this.fleetRule() !== null;
    // So vira `true` DEPOIS de o servidor confirmar o desligamento: e o que decide se a frase
    // de erro pode dizer que a regra anterior ficou desligada.
    let deactivated = false;
    let call: Observable<unknown>;
    if (v.scope === 'ONE') {
      call = this.schedules.create(v.vehicleId, payload);
    } else if (replacingFleet) {
      // Substituir a frota = desligar a atual e criar a nova. Ver o cabecalho.
      call = this.schedules.deactivateFleet().pipe(
        tap(() => (deactivated = true)),
        switchMap(() => this.schedules.createForFleet(payload)),
      );
    } else {
      call = this.schedules.createForFleet(payload);
    }

    call.subscribe({
      next: () => {
        this.saving.set(false);
        this.open.set(false);
        this.notifications.success(
          v.scope === 'FLEET'
            ? 'Agendamento da frota salvo.'
            : `Agendamento de «${this.plateOf(v.vehicleId) ?? 'veículo'}» salvo.`,
        );
        this.load();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.formError.set(this.failureMessage(err, deactivated));
        // O estado mudou no meio (a regra anterior foi desligada): reler para a tela dizer a verdade.
        if (deactivated) this.load();
      },
    });
  }

  protected askTurnOff(): void {
    if (this.canTurnOff() && !this.saving()) this.confirmingOff.set(true);
  }

  protected dismissTurnOff(): void {
    this.confirmingOff.set(false);
  }

  protected confirmTurnOff(): void {
    const target = this.turnOffTarget();
    this.confirmingOff.set(false);
    if (!target || this.saving()) return;

    this.saving.set(true);
    this.formError.set(null);
    const call =
      target.kind === 'FLEET'
        ? this.schedules.deactivateFleet()
        : this.schedules.deactivate(target.vehicleId);
    call.subscribe({
      next: () => {
        this.saving.set(false);
        this.open.set(false);
        this.notifications.success(
          target.kind === 'FLEET'
            ? 'Agendamento automático desativado.'
            : `Agendamento de «${target.plate}» desativado.`,
        );
        this.load();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.formError.set(this.failureMessage(err, false));
      },
    });
  }

  // ----------------------------------------------------------------- helpers

  /** "a cada 15 dias", "todo mês" — o rotulo do servidor em minuscula, para caber em frase. */
  private phrase(frequency: InspectionFrequency): string {
    const label = inspectionFrequencyLabel(frequency);
    return label.charAt(0).toLowerCase() + label.slice(1);
  }

  /** A placa de um veiculo — a primeira parte do rotulo "PLACA · modelo". */
  private plateOf(vehicleId: string): string | null {
    if (!vehicleId) return null;
    const label = this.vehicleOptions().find((v) => v.id === vehicleId)?.label;
    if (!label) return null;
    return label.split(/\s[·—-]\s/)[0] || label;
  }

  private failureMessage(err: unknown, afterDeactivate: boolean): string {
    if (err instanceof HttpErrorResponse && err.status === 403) {
      this.apiErrors.claim(err);
      return 'Só o dono e os gerenciadores podem agendar vistorias.';
    }
    const fallback = afterDeactivate
      ? 'O agendamento anterior foi desativado, mas não foi possível salvar o novo. Tente de novo.'
      : 'Não foi possível salvar o agendamento. Tente de novo.';
    return this.apiErrors.messageFor(err, fallback);
  }
}
