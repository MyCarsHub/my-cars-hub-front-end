export type SignatureStatus = 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED';

export interface SignatureResponse {
  id: string;
  status: SignatureStatus;
  signedAt: string | null;
  subscriptionId: string;
}

export interface SignatureCaptureRequest {
  signatureData: string;
  subscriptionId: string;
}
