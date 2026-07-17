import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

const BASE = `${environment.apiUrl}/settings/contract-template`;

export interface ContractTemplateDto {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string | null;
  detectedPlaceholders: string[];
  supportedVariables: string[];
}

@Injectable({ providedIn: 'root' })
export class ContractTemplateService {
  private readonly http = inject(HttpClient);

  upload(file: File): Observable<ContractTemplateDto> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ContractTemplateDto>(BASE, form);
  }

  get(): Observable<ContractTemplateDto> {
    return this.http.get<ContractTemplateDto>(BASE);
  }

  delete(): Observable<void> {
    return this.http.delete<void>(BASE);
  }

  /** Devolve URL de download do render pra pré-visualizar num rental existente. */
  renderUrl(rentalId: string): string {
    return `${BASE}/render/${rentalId}`;
  }

  /**
   * Baixa o markdown com instruções pra colar em ChatGPT/Claude. Content-Type
   * é `text/markdown` — pedimos como texto puro pra manipular no cliente
   * (copiar pro clipboard ou salvar como .md).
   */
  aiInstructions(): Observable<string> {
    return this.http.get(`${BASE}/ai-instructions`, { responseType: 'text' });
  }

  /**
   * Baixa o contrato de locação COMPLETO em markdown com placeholders prontos.
   * Usuário cola no Word/Docs, salva como .docx e faz upload no dropzone.
   */
  example(): Observable<string> {
    return this.http.get(`${BASE}/example`, { responseType: 'text' });
  }
}
