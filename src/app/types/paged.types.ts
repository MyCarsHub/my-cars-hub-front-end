/**
 * Canonical wire shape of the backend paged response (`PagedResponseDto`).
 * Jackson serializes Java records verbatim so the JSON keys are exactly
 * `content` / `page` / `size` / `total`.
 *
 * Every frontend list service must read from these keys — do NOT invent a
 * new shape (`items`, `totalElements`, `data`, etc.). See notebook
 * `paged-response-shape.md`.
 */
export interface PagedResponse<T> {
  content: T[];
  page: number;
  size: number;
  total: number;
}
