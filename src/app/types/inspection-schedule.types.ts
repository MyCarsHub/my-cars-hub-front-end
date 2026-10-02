/**
 * Contract of `/v1/vehicles/{vehicleId}/inspection-schedule` (backend `origin/main @ 33b3c31`).
 *
 * Three properties of this contract shape the screen, and two of them are absences:
 *
 * 1. **Everything is keyed by `vehicleId`, in the PATH.** Create, read and deactivate all
 *    live under the vehicle. There is no company-wide route, which is why the UI lives on
 *    the vehicle screen: that is the only place holding the id the call requires.
 * 2. **`GET` returns ONE schedule, not a list.** A vehicle has at most one active schedule.
 *    Listing every schedule in the fleet has no endpoint at all.
 * 3. **Fleet-wide scheduling is NOT reachable.** The table (V86) accepts a null vehicle,
 *    but no route does: `vehicleId` is a mandatory path variable and the service takes a
 *    plain `UUID` with no null branch. Do not build a "whole fleet" option against this
 *    contract — it needs a new endpoint.
 */

/**
 * How often the inspection comes due. The backend enum is the source; these are the exact
 * seven values it accepts, and the labels live in `INSPECTION_FREQUENCY_OPTIONS` because the
 * enum name is not something to show a person.
 */
export type InspectionFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUAL'
  | 'YEARLY';

/**
 * Labels in the words a person uses, not the enum's.
 *
 * "A cada 3 meses" is what the owner of a rental company says; QUARTERLY is what the column
 * stores. The translation lives here so every screen reads the same list and adding a
 * frequency means editing one place.
 */
export const INSPECTION_FREQUENCY_OPTIONS: ReadonlyArray<{
  value: InspectionFrequency;
  label: string;
}> = [
  { value: 'DAILY', label: 'Todo dia' },
  { value: 'WEEKLY', label: 'Toda semana' },
  { value: 'BIWEEKLY', label: 'A cada 15 dias' },
  { value: 'MONTHLY', label: 'Todo mês' },
  { value: 'QUARTERLY', label: 'A cada 3 meses' },
  { value: 'SEMIANNUAL', label: 'A cada 6 meses' },
  { value: 'YEARLY', label: 'Todo ano' },
];

/** Label for a frequency, falling back to the raw value so a new enum stays visible. */
export function inspectionFrequencyLabel(frequency: string): string {
  return INSPECTION_FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.label ?? frequency;
}

/**
 * Body of `POST /v1/vehicles/{vehicleId}/inspection-schedule`.
 *
 * `reminderIntervalDays` is OPTIONAL (`@Min(1)` when sent): omitting it lets the backend keep
 * its own default instead of the screen inventing one.
 */
export interface CreateInspectionScheduleRequest {
  frequency: InspectionFrequency;
  /** ISO date (`yyyy-MM-dd`) — the backend reads a `LocalDate`, never a timestamp. */
  startDate: string;
  reminderIntervalDays?: number;
}

/**
 * Body of `GET` and `POST`.
 *
 * `nextDueDate` is COMPUTED BY THE SERVER from frequency and start date. The screen shows it
 * and never predicts it: a second calculation here would be a second rule for one question,
 * and the two would drift.
 */
export interface InspectionScheduleResponse {
  id: string;
  vehicleId: string;
  frequency: InspectionFrequency;
  startDate: string;
  nextDueDate: string;
  reminderIntervalDays: number;
  active: boolean;
}
