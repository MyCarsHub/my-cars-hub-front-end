import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AlertBanner } from '../../../components/alert-banner/alert-banner';
import { DefaultPageLayout } from '../../../components/layout/default-page-layout/default-page-layout';
import type { InspectionStatus } from '../../../types/inspection.types';
import type { AngleFrame } from '../inspection-view';

/** One line of "Resumo". */
export interface DetailField {
  readonly label: string;
  readonly value: string;
}

/**
 * `/vistorias/:id` for the DRIVER (owner's prototype "Motorista Vistorias", detail view):
 * status, the refusal and its redo, the summary, the photos sent and — once approved — the
 * report. Presentation only: `InspectionReview` loads everything, and photos and the report
 * open in the app's viewer (`DocumentPreviewService`) through it.
 */
@Component({
  selector: 'app-driver-inspection-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertBanner, DefaultPageLayout],
  templateUrl: './driver-inspection-detail.html',
})
export class DriverInspectionDetail {
  readonly loading = input(false);
  readonly loadError = input<string | null>(null);
  readonly status = input<InspectionStatus>('PENDING');
  readonly statusLabel = input('');
  readonly chipClass = input('');
  readonly subtitle = input('');
  readonly fields = input<readonly DetailField[]>([]);
  readonly rejectionReason = input<string | null>(null);
  readonly frames = input<readonly AngleFrame[]>([]);
  readonly photosLoading = input(false);
  readonly photosError = input<string | null>(null);
  readonly photoSummary = input('');
  readonly canRetryPhotos = input(false);
  readonly pdfName = input('vistoria.pdf');
  readonly listLink = input('/vistorias');
  readonly captureLink = input<readonly string[]>([]);

  readonly retry = output<void>();
  readonly retryPhotos = output<void>();
  readonly openPhoto = output<string>();
  readonly openReport = output<void>();
  readonly imageError = output<void>();
}
