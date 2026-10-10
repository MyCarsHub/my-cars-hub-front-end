import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { DriverProfileData, DriverProfileUpdate } from '../types/driver-ledger.types';
import { toDriverProfile } from '../utils/driver-area-adapters';

const PROFILE = `${environment.apiUrl}/driver/profile`;

/**
 * HTTP port of the driver's own record (`/v1/driver/profile`).
 *
 * The PUT carries ONLY phone and address: name, document, CNH and status belong to the
 * company that registered him, and the server ignores (or refuses) anything else — the
 * type of `DriverProfileUpdate` makes it impossible to send more by accident.
 */
@Injectable({ providedIn: 'root' })
export class DriverProfileService {
  private readonly http = inject(HttpClient);

  get(): Observable<DriverProfileData> {
    return this.http.get<unknown>(PROFILE).pipe(map(toDriverProfile));
  }

  update(payload: DriverProfileUpdate): Observable<DriverProfileData> {
    return this.http.put<unknown>(PROFILE, payload).pipe(map(toDriverProfile));
  }
}
