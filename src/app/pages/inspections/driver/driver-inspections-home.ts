import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';

/** A way out of the hero: a link (continue, redo) or starting a new inspection of a car. */
export interface HeroAction {
  readonly label: string;
  readonly link?: readonly string[];
  readonly queryParams?: Readonly<Record<string, string>>;
  readonly vehicleId?: string;
}

/** The big block at the top: what the driver has to do about inspections right now. */
export interface DriverInspectionHero {
  /** `primary` = there is something to do; `rose` = refused; `emerald` = waiting; `neutral` = nothing. */
  readonly tone: 'primary' | 'rose' | 'emerald' | 'neutral';
  readonly label: string;
  readonly title: string;
  readonly sub: string;
  readonly actions: readonly HeroAction[];
}

/** One card of "Minhas vistorias". */
export interface DriverInspectionItem {
  readonly id: string;
  readonly plate: string;
  readonly model: string | null;
  readonly statusLabel: string;
  readonly chipClass: string;
  readonly meta: string;
  readonly note: string | null;
  readonly noteTone: 'rose' | 'emerald' | null;
  readonly photoUrl: string | null;
  readonly actionLabel: string;
  readonly actionLink: readonly string[];
}

const HERO_TONES: Readonly<Record<DriverInspectionHero['tone'], string>> = {
  primary: 'bg-primary-500 text-white',
  rose: 'bg-rose-700 text-white',
  emerald: 'bg-emerald-700 text-white',
  neutral: 'bg-white text-neutral-900 border border-neutral-200',
};

/**
 * `/vistorias` for the DRIVER (owner's prototype "Motorista Vistorias"): a hero with the one
 * thing to do now, then "Minhas vistorias" as cards. Presentation only — `InspectionsList`
 * loads the data and decides the hero.
 *
 * States: skeleton, load error with "Tentar novamente", and an empty message (never an empty
 * card). The driver's list has no filters, so "empty with filters" cannot happen here.
 */
@Component({
  selector: 'app-driver-inspections-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertBanner, DefaultPageLayout],
  templateUrl: './driver-inspections-home.html',
})
export class DriverInspectionsHome {
  readonly state = input.required<'loading' | 'error' | 'ready'>();
  readonly errorMessage = input<string | null>(null);
  /** `null` while what the hero depends on is still loading. */
  readonly hero = input<DriverInspectionHero | null>(null);
  readonly heroError = input<string | null>(null);
  readonly startError = input<string | null>(null);
  readonly items = input<readonly DriverInspectionItem[]>([]);
  readonly countLabel = input('');
  readonly pageLabel = input<string | null>(null);
  readonly hasPrev = input(false);
  readonly hasNext = input(false);

  readonly retry = output<void>();
  readonly retryHero = output<void>();
  readonly start = output<string>();
  readonly prev = output<void>();
  readonly next = output<void>();
  readonly photoError = output<string>();

  protected heroClass(tone: DriverInspectionHero['tone']): string {
    return HERO_TONES[tone];
  }
}
