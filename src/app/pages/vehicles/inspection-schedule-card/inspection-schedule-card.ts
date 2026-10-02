import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { ConfirmDialog } from '../../../components/core/confirm-dialog/confirm-dialog';
import { PageCard } from '../../../components/core/page-card/page-card';
import { FieldControl, FormField } from '../../../components/form-field/form-field';
import { ApiErrorService } from '../../../services/api-error.service';
import { InspectionScheduleService } from '../../../services/inspection-schedule.service';
import { NotificationService } from '../../../services/notification.service';
import {
  INSPECTION_FREQUENCY_OPTIONS,
  InspectionFrequency,
  InspectionScheduleResponse,
  inspectionFrequencyLabel,
} from '../../../types/inspection-schedule.types';

/**
 * Vistoria periodica de UM veiculo: ver, agendar e desligar.
 *
 * ## Por que aqui, na tela do veiculo
 *
 * As tres rotas do backend sao `/v1/vehicles/{vehicleId}/inspection-schedule` — criar, ler e
 * desativar, todas chaveadas pelo veiculo NO CAMINHO. A tela do veiculo e o unico lugar que
 * JA tem o id que a chamada exige. Na tela de vistorias eu teria de fazer a pessoa escolher
 * um veiculo primeiro, inventando um passo que o backend nao pede — e e tambem onde a pessoa
 * esta quando pensa "este carro precisa de vistoria periodica": olhando o carro.
 *
 * ## O 404 do GET e a resposta NORMAL
 *
 * Veiculo sem agendamento responde 404. Hoje esse e o caso da esmagadora maioria dos carros
 * — a medicao que originou este trabalho foi exatamente "ZERO agendamentos em producao".
 * Entao 404 pinta o estado vazio com o convite para agendar, e nunca uma faixa de erro.
 *
 * ## O que esta tela NAO oferece, e nao e esquecimento
 *
 * Agendar para a FROTA INTEIRA. A tabela aceita veiculo nulo, mas nenhuma rota alcanca isso:
 * `vehicleId` e path variable obrigatorio e o service recebe um `UUID` sem ramo para nulo.
 * Oferecer um botao "toda a frota" aqui seria inventar chamada. Depende de endpoint novo.
 *
 * ## `nextDueDate` vem do servidor
 *
 * A proxima data e CALCULADA pelo backend a partir da frequencia e do inicio. A tela mostra
 * e nao recalcula: duas contas para a mesma pergunta divergem com o tempo.
 */
@Component({
  selector: 'app-inspection-schedule-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    PageCard,
    AlertBanner,
    ConfirmDialog,
    FormField,
    FieldControl,
  ],
  templateUrl: './inspection-schedule-card.html',
})
export class InspectionScheduleCard implements OnInit {
  /** O veiculo desta tela. Vazio enquanto o pai ainda carrega — o card espera. */
  readonly vehicleId = input.required<string>();

  private readonly fb = inject(FormBuilder);
  private readonly schedules = inject(InspectionScheduleService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  protected readonly schedule = signal<InspectionScheduleResponse | null>(null);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pendingDeactivate = signal(false);
  /**
   * A leitura FALHOU por outro motivo que nao 404.
   *
   * Sem isto, falha virava "estado vazio": a tela afirmava "este veiculo nao tem vistoria
   * periodica" quando a verdade e que ela NAO SABE — e oferecia agendar, que sobre um
   * agendamento existente seria sobrescrever as cegas. Falha e falha; ausencia e 404.
   */
  protected readonly loadFailed = signal(false);

  protected readonly frequencies = INSPECTION_FREQUENCY_OPTIONS;

  /** `true` quando o veiculo nao tem agendamento — o estado vazio, nao um erro. */
  protected readonly isEmpty = computed(
    () => this.loaded() && !this.loadFailed() && this.schedule() === null,
  );

  protected readonly frequencyLabel = computed(() => {
    const current = this.schedule();
    return current ? inspectionFrequencyLabel(current.frequency) : '';
  });

  protected readonly scheduleForm = this.fb.group({
    frequency: this.fb.nonNullable.control<InspectionFrequency>('MONTHLY', {
      validators: [Validators.required],
    }),
    startDate: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    reminderIntervalDays: this.fb.control<number | null>(null, {
      validators: [Validators.min(1)],
    }),
  });

  protected readonly startDateMessages: Readonly<Record<string, string>> = {
    required: 'Escolha a partir de quando a vistoria passa a valer.',
  };
  protected readonly reminderMessages: Readonly<Record<string, string>> = {
    min: 'O aviso tem de ser de pelo menos 1 dia antes.',
  };

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    const id = this.vehicleId();
    if (!id) return;

    this.loading.set(true);
    this.error.set(null);
    this.loadFailed.set(false);
    this.schedules.get(id).subscribe({
      next: (found) => {
        // `active: false` e um agendamento desligado: para a tela, e o mesmo que nao ter.
        this.schedule.set(found.active ? found : null);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loaded.set(true);
        // 404 = "este veiculo nao tem agendamento". E a resposta normal, nao uma falha.
        if (err.status === 404) {
          this.schedule.set(null);
          return;
        }
        this.loadFailed.set(true);
        this.error.set(this.messageFor(err, 'Não foi possível carregar a vistoria periódica.'));
      },
    });
  }

  protected openForm(): void {
    const current = this.schedule();
    this.scheduleForm.reset({
      frequency: current?.frequency ?? 'MONTHLY',
      startDate: current?.startDate ?? '',
      reminderIntervalDays: current?.reminderIntervalDays ?? null,
    });
    this.error.set(null);
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
  }

  protected save(): void {
    if (this.saving()) return;
    if (this.scheduleForm.invalid) {
      this.scheduleForm.markAllAsTouched();
      return;
    }

    const raw = this.scheduleForm.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.schedules
      .create(this.vehicleId(), {
        frequency: raw.frequency,
        startDate: raw.startDate,
        // Ausente em vez de nulo: sem valor, o backend mantem o padrao DELE em vez de a
        // tela inventar um numero de dias.
        ...(raw.reminderIntervalDays ? { reminderIntervalDays: raw.reminderIntervalDays } : {}),
      })
      .subscribe({
        next: (created) => {
          this.saving.set(false);
          this.formOpen.set(false);
          this.schedule.set(created);
          this.notifications.success('Vistoria periódica agendada para este veículo.');
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(this.messageFor(err, 'Não foi possível agendar a vistoria.'));
        },
      });
  }

  protected askDeactivate(): void {
    this.pendingDeactivate.set(true);
  }

  protected dismissDeactivate(): void {
    this.pendingDeactivate.set(false);
  }

  /** Agendamento que nao da para desligar e armadilha, entao desligar e primeira classe. */
  protected confirmDeactivate(): void {
    this.pendingDeactivate.set(false);
    this.saving.set(true);
    this.error.set(null);
    this.schedules.deactivate(this.vehicleId()).subscribe({
      next: () => {
        this.saving.set(false);
        this.schedule.set(null);
        this.notifications.success('Vistoria periódica desligada para este veículo.');
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(this.messageFor(err, 'Não foi possível desligar a vistoria periódica.'));
      },
    });
  }

  private messageFor(err: HttpErrorResponse, fallback: string): string {
    if (err.status === 403) {
      return 'Você não tem permissão para alterar a vistoria periódica deste veículo.';
    }
    return this.apiErrors.messageFor(err, fallback);
  }
}
