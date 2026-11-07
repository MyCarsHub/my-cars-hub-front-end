import { defineConfig } from 'vitest/config';

/**
 * Loaded by `ng test` through `runnerConfig: true` (angular.json). The file name
 * is mandatory: the Angular builder only looks for `vitest-base.config.*`. The
 * builder keeps owning include/plugins/setupFiles/environment; only the knobs
 * below are ours.
 *
 * Why these two numbers exist: vitest defaults (5s test / 10s hook) leave almost
 * no headroom on the shared CI runner. Measured over 21 green runs of this
 * workflow, the slowest single test (inspection-capture "comprime ANTES de
 * subir") took 2.5s to 4.0s against the 5s default, and the same code took
 * 39s to 57s for the whole suite depending on the runner. Two unrelated PRs then
 * failed on one spec each with a pure timeout (a 20s stall of a spec that takes
 * ~30ms in every green run). A timeout is a ceiling for a HUNG test, not an
 * assertion: raising it changes no expectation and skips no spec, and a genuine
 * hang still fails, only later.
 */
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
