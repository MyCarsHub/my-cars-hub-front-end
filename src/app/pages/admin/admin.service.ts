import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface NotificationTestResponse {
  to: string;
  dispatched: string[];
  count: number;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);

  testNotifications(email: string): Observable<NotificationTestResponse> {
    const url = `${environment.apiUrl}/admin/notifications/test?email=${encodeURIComponent(email)}`;
    return this.http.post<NotificationTestResponse>(url, null);
  }
}
