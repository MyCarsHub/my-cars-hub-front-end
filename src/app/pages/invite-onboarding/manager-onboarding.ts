import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DOCUMENT, NgOptimizedImage } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AlertBanner } from '../../components/alert-banner/alert-banner';
import { FieldControl, FormField } from '../../components/form-field/form-field';
import { DriverOnboarding } from './driver-onboarding';
import { InviteFlowService } from '../../services/invite-flow.service';
import { onboardingFailure } from '../../services/invite-flow-errors';
import { InviteOnboardingTokenStore } from '../../services/invite-onboarding-token.store';
import {
  INVITE_TERMS_VERSION,
  InviteOnboardingContext,
} from '../../types/invite-flow.types';
import { applyMaskedPhoneInput, maskPhone, normalizePhone } from '../../utils/phone-mask';

/** Same pattern as the owner onboarding and the old accept page: DDD + number. */
const PHONE_PATTERN = /^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$|^\d{10,11}$/;

type Step = 1 | 2 | 3;
type Mode = 'loading' | 'wizard' | 'driver' | 'blocked';

const STEP_TITLES: Readonly<Record<Step, string>> = {
  1: 'Seus dados',
  2: 'Termos e privacidade',
  3: 'Tudo pronto',
};

const TOTAL_STEPS = 3;

/**
 * Manager onboarding behind an invite: `/convite/cadastro`, guarded by "has onboarding token".
 *
 * 1. Seus dados - name and phone from `GET /invite-onboarding`; editable ONLY when the backend
 *    says `identityEditable`, otherwise read-only (the CPF-verified identity is not ours to edit).
 * 2. Termos e privacidade - the checkbox is the consent; submitting it calls `POST manager`.
 * 3. Tudo pronto - the returned ACCESS token is already stored through the normal login path.
 */
@Component({
  selector: 'app-manager-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgOptimizedImage,
    RouterLink,
    AlertBanner,
    ReactiveFormsModule,
    FormField,
    FieldControl,
    DriverOnboarding,
  ],
  templateUrl: './manager-onboarding.html',
})
export class ManagerOnboarding implements OnInit {
  private readonly flow = inject(InviteFlowService);
  private readonly onboardingToken = inject(InviteOnboardingTokenStore);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly fb = inject(FormBuilder);

  protected readonly totalSteps = TOTAL_STEPS;
  protected readonly stepNumbers = [1, 2, 3] as const;

  protected readonly mode = signal<Mode>('loading');
  protected readonly step = signal<Step>(1);
  protected readonly context = signal<InviteOnboardingContext | null>(null);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly termsError = signal(false);
  protected readonly blockedMessage = signal('');
  /** First name shown on the last step. */
  protected readonly firstName = signal('');

  protected readonly greeting = computed(() => (this.firstName() ? `, ${this.firstName()}` : ''));
  protected readonly title = computed(() => STEP_TITLES[this.step()]);
  protected readonly companyName = computed(() => this.context()?.companyName ?? '');
  protected readonly roleLabel = computed(() => this.context()?.roleLabel ?? '');
  protected readonly editable = computed(() => this.context()?.identityEditable === true);

  protected readonly form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, Validators.pattern(PHONE_PATTERN)]],
    terms: [false],
  });

  protected readonly nameMessages: Readonly<Record<string, string>> = {
    required: 'Informe seu nome completo.',
    minlength: 'Informe seu nome completo.',
    server: 'Confira seu nome completo.',
  };
  protected readonly phoneMessages: Readonly<Record<string, string>> = {
    required: 'Informe seu telefone.',
    pattern: 'Confira o telefone com o DDD, como (11) 91234-5678.',
    server: 'Confira o telefone com o DDD, como (11) 91234-5678.',
  };

  ngOnInit(): void {
    this.flow.loadOnboarding().subscribe({
      next: (context) => this.start(context),
      error: (err: unknown) => this.block(err),
    });
  }

  protected onPhoneInput(event: Event): void {
    applyMaskedPhoneInput(event, this.form.controls.phone);
  }

  protected next(): void {
    if (this.step() !== 1) return;
    const { name, phone } = this.form.controls;
    // Read-only identity is not validated: the user cannot fix it, and the backend has the last word.
    if (this.editable() && (name.invalid || phone.invalid)) {
      name.markAsTouched();
      phone.markAsTouched();
      return;
    }
    this.errorMessage.set(null);
    this.step.set(2);
  }

  protected back(): void {
    if (this.step() === 2 && !this.submitting()) this.step.set(1);
  }

  protected acceptTerms(): void {
    if (this.submitting() || this.step() !== 2) return;
    if (!this.form.controls.terms.value) {
      this.termsError.set(true);
      return;
    }
    this.termsError.set(false);
    this.errorMessage.set(null);
    this.submitting.set(true);

    const raw = this.form.getRawValue();
    const name = raw.name.trim();
    this.flow
      .submitManager({
        name,
        // Masked display value, as the backend gave it, when the identity is read-only.
        phone: this.editable() ? normalizePhone(raw.phone) : raw.phone,
        acceptedTermsVersion: INVITE_TERMS_VERSION,
      })
      .subscribe({
        next: (response) => {
          this.submitting.set(false);
          const context = this.context();
          this.flow.signIn(
            response.accessToken,
            { name: context?.companyName ?? '', role: context?.role ?? 'MANAGER' },
            name,
          );
          this.onboardingToken.clear();
          this.firstName.set(name.split(/\s+/)[0] ?? '');
          this.step.set(3);
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          this.fail(err);
        },
      });
  }

  protected goToDashboard(): void {
    void this.router.navigate(['/dashboard'], { replaceUrl: true }).then((ok) => {
      // A guard refused: a full reload re-decides with the new session.
      if (!ok) this.document.defaultView?.location.assign('/');
    });
  }

  private start(context: InviteOnboardingContext): void {
    this.context.set(context);
    if (context.role !== 'MANAGER') {
      // The DRIVER wizard is its own component (CNH + address; no terms step).
      this.mode.set('driver');
      return;
    }
    const phoneIsConcrete = /^[\d\s()+-]+$/.test(context.prefill.phoneMasked ?? '');
    this.form.patchValue({
      name: context.prefill.name ?? '',
      // A masked number ("(11) 9****-4321") cannot be submitted, so an editable field starts empty.
      phone: !context.identityEditable || phoneIsConcrete ? maskPhone(context.prefill.phoneMasked ?? '') : '',
    });
    if (!context.identityEditable) {
      this.form.controls.name.disable();
      this.form.controls.phone.disable();
    }
    this.mode.set('wizard');
  }

  /** The driver wizard says it cannot go on (revoked token, already done, other role). */
  protected onDriverBlocked(message: string): void {
    this.blockedMessage.set(message);
    this.mode.set('blocked');
  }

  private block(err: unknown): void {
    const failure = onboardingFailure(err);
    this.blockedMessage.set(failure.message);
    if (failure.kind === 'revoked') this.onboardingToken.clear();
    this.mode.set('blocked');
  }

  private fail(err: unknown): void {
    const failure = onboardingFailure(err);
    switch (failure.kind) {
      case 'field': {
        const control = this.form.controls[failure.field];
        control.setErrors({ server: true });
        control.markAsTouched();
        this.step.set(1);
        return;
      }
      case 'terms':
        this.errorMessage.set(failure.message);
        return;
      case 'wrong-role':
      case 'revoked':
      case 'done':
        if (failure.kind === 'revoked') this.onboardingToken.clear();
        this.blockedMessage.set(failure.message);
        this.mode.set('blocked');
        return;
      default:
        this.errorMessage.set(failure.message);
    }
  }
}
