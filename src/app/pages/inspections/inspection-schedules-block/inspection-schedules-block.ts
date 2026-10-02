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

/** Uma linha de agendamento, pronta para desenhar. */
interface ScheduleRow {
  id: string;
  /** `true` quando e a regra da FROTA — decide a forma da linha, nao so o rotulo. */
  fleet: boolean;
  /** "Toda a frota" ou a placa/modelo do carro. */
  title: string;
  frequencyLabel: string;
  nextDueDate: string;
  reminderIntervalDays: number;
  /** `null` na linha de frota. */
  vehicleId: string | null;
  /** Frase que explica a precedencia nesta linha, ou vazio. */
  precedenceNote: string;
  /** `true` quando ESTA tela pode desligar a linha. */
  canDeactivate: boolean;
  /** Por que nao da para desligar, quando nao da. */
  lockedReason: string;
}

/**
 * Agendamento de vistoria no escopo da EMPRESA — a regra da frota e as regras por carro.
 *
 * ## Por que aqui e nao dentro do veiculo
 *
 * O cartao dentro do veiculo continua existindo e e o lugar certo para "este carro em
 * particular". Mas quem pensa "quero vistoria periodica na minha frota" nao vai procurar
 * dentro de um carro, e agendar carro a carro sao dez visitas a dez telas numa frota de
 * dez. Esta tela e o escopo da empresa.
 *
 * ## A precedencia que a tela MOSTRA, medida no SQL e nao inventada
 *
 * `findEffectiveSchedule` faz
 * `WHERE (s.vehicle_id = ? OR s.vehicle_id IS NULL) ORDER BY (s.vehicle_id IS NULL) LIMIT 1`
 * — em Postgres `false` ordena antes de `true`, entao a linha que NOMEIA o veiculo vem
 * primeiro: **o agendamento do carro vence o da frota**. Criar a regra de frota nao altera
 * nem recusa as regras de carro que ja existem.
 *
 * A tela diz isso em portugues na propria linha, em vez de um selo que ninguem decifra.
 *
 * ## O que a frota alcanca
 *
 * Uma linha com `vehicle_id` nulo vale para todos os carros elegiveis, **inclusive os
 * cadastrados depois** — o motor materializa por carro no vencimento. E so para carro que
 * esta NA frota: vendido e inativo ficam fora, por um `EXISTS` na propria consulta.
 *
 * ## O que ainda nao da para fazer, e a linha diz
 *
 * Desligar ou alterar a regra da FROTA. O unico `DELETE` e por veiculo e nao alcanca
 * `vehicle_id` nulo. Linha sem acao E SEM EXPLICACAO e pior que linha sem acao, entao a
 * faixa de frota carrega a razao. Quando `DELETE /v1/inspection-schedules/fleet` existir,
 * o botao entra e a frase sai.
 */
@Component({
  selector: 'app-inspection-schedules-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ReactiveFormsModule, AlertBanner, ConfirmDialog, FormField, FieldControl],
  templateUrl: './inspection-schedules-block.html',
})
export class InspectionSchedulesBlock implements OnInit {
  /** Placas/modelos para nomear a linha de carro — a lista de agendamentos so traz o id. */
  readonly vehicleOptions = input<ReadonlyArray<{ id: string; label: string }>>([]);

  private readonly fb = inject(FormBuilder);
  private readonly schedules = inject(InspectionScheduleService);
  private readonly apiErrors = inject(ApiErrorService);
  private readonly notifications = inject(NotificationService);

  private readonly all = signal<InspectionScheduleResponse[]>([]);
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly saving = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pendingDeactivate = signal<ScheduleRow | null>(null);

  protected readonly frequencies = INSPECTION_FREQUENCY_OPTIONS;

  protected readonly hasFleetRule = computed(() => this.all().some((s) => isFleetSchedule(s)));

  /**
   * Nada agendado: a tela inteira vira convite. Falha de leitura NAO conta como vazio — a
   * tela nao sabe, e convidar a agendar sobre uma regra que talvez exista criaria a segunda
   * regra de frota que o backend recusa com 400.
   */
  protected readonly isEmpty = computed(
    () => this.loaded() && !this.loadFailed() && this.all().length === 0,
  );

  /**
   * FROTA primeiro, depois os carros por nome.
   *
   * A regra da empresa vem antes porque e ela que explica as outras: lida depois, a frase
   * "este carro usa a regra dele" nao tem a que se referir.
   */
  protected readonly rows = computed<ScheduleRow[]>(() => {
    const fleetExists = this.hasFleetRule();
    const fleet = this.all().filter((s) => isFleetSchedule(s)).map((s) => this.toRow(s, fleetExists));
    const vehicles = this.all()
      .filter((s) => !isFleetSchedule(s))
      .map((s) => this.toRow(s, fleetExists));
    vehicles.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    return [...fleet, ...vehicles];
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
    required: 'Escolha a partir de quando as vistorias passam a valer.',
  };
  protected readonly reminderMessages: Readonly<Record<string, string>> = {
    min: 'O aviso tem de ser de pelo menos 1 dia antes.',
  };

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.loadFailed.set(false);
    this.schedules.listForCompany().subscribe({
      next: (found) => {
        this.all.set((found ?? []).filter((s) => s.active));
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.loaded.set(true);
        this.loadFailed.set(true);
        this.error.set(this.messageFor(err, 'Não foi possível carregar os agendamentos.'));
      },
    });
  }

  protected openForm(): void {
    this.scheduleForm.reset({ frequency: 'MONTHLY', startDate: '', reminderIntervalDays: null });
    this.error.set(null);
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
  }

  protected saveFleet(): void {
    if (this.saving()) return;
    if (this.scheduleForm.invalid) {
      this.scheduleForm.markAllAsTouched();
      return;
    }

    const raw = this.scheduleForm.getRawValue();
    this.saving.set(true);
    this.error.set(null);
    this.schedules
      .createForFleet({
        frequency: raw.frequency,
        startDate: raw.startDate,
        ...(raw.reminderIntervalDays ? { reminderIntervalDays: raw.reminderIntervalDays } : {}),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.formOpen.set(false);
          this.notifications.success(
            'Vistoria periódica agendada para toda a frota, inclusive os carros que você cadastrar depois.',
          );
          // RELER: a resposta do POST traz a regra nova, mas nao as de carro que ja existiam,
          // e a tela precisa das duas para explicar a precedencia.
          this.load();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.error.set(this.fleetCreateMessage(err));
        },
      });
  }

  protected askDeactivate(row: ScheduleRow): void {
    if (row.canDeactivate) this.pendingDeactivate.set(row);
  }

  protected dismissDeactivate(): void {
    this.pendingDeactivate.set(null);
  }

  protected confirmDeactivate(): void {
    const row = this.pendingDeactivate();
    if (!row || !row.vehicleId) return;
    this.pendingDeactivate.set(null);
    this.saving.set(true);
    this.error.set(null);
    this.schedules.deactivate(row.vehicleId).subscribe({
      next: () => {
        this.saving.set(false);
        this.notifications.success('Vistoria periódica desligada para ' + row.title + '.');
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(this.messageFor(err, 'Não foi possível desligar este agendamento.'));
      },
    });
  }

  private toRow(schedule: InspectionScheduleResponse, fleetExists: boolean): ScheduleRow {
    const fleet = isFleetSchedule(schedule);
    return {
      id: schedule.id,
      fleet,
      title: fleet ? 'Toda a frota' : this.vehicleLabel(schedule.vehicleId),
      frequencyLabel: inspectionFrequencyLabel(schedule.frequency),
      nextDueDate: schedule.nextDueDate,
      reminderIntervalDays: schedule.reminderIntervalDays,
      vehicleId: schedule.vehicleId,
      precedenceNote: this.precedenceNote(fleet, fleetExists),
      // Frota nao: nao existe endpoint que alcance `vehicle_id` nulo.
      canDeactivate: !fleet,
      lockedReason: fleet
        ? 'Para mudar ou desligar a regra da frota, fale com o suporte — ainda não é possível por aqui.'
        : '',
    };
  }

  /**
   * A frase da precedencia, e ela so aparece quando HA conflito a explicar.
   *
   * Numa empresa sem regra de frota, dizer "este carro usa a regra dele" explica um conflito
   * que nao existe e sobra como ruido.
   */
  private precedenceNote(fleet: boolean, fleetExists: boolean): string {
    if (fleet) {
      return 'Vale para os carros que não têm regra própria, inclusive os cadastrados depois.';
    }
    return fleetExists ? 'Este carro usa a regra dele, não a da frota.' : '';
  }

  private vehicleLabel(vehicleId: string | null): string {
    if (!vehicleId) return 'Veículo';
    return this.vehicleOptions().find((v) => v.id === vehicleId)?.label ?? 'Veículo';
  }

  /**
   * 400 ao criar frota tem uma causa que NAO e erro de preenchimento: ja existe uma regra de
   * frota vigente, e o backend garante no maximo uma. A frase diz o estado, nao "falhou".
   */
  private fleetCreateMessage(err: HttpErrorResponse): string {
    if (err.status === 400 && this.hasFleetRule()) {
      return 'Esta empresa já tem uma regra de vistoria para a frota.';
    }
    return this.messageFor(err, 'Não foi possível agendar para a frota.');
  }

  private messageFor(err: HttpErrorResponse, fallback: string): string {
    if (err.status === 403) {
      return 'Só o dono e os gerenciadores podem agendar vistorias.';
    }
    return this.apiErrors.messageFor(err, fallback);
  }
}
