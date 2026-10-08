'use strict';
/* =====================================================================
 * FCBGA thermomechanical screening tool: physics core.
 * This block has no DOM dependencies. It is loaded by the UI thread, by
 * the Web Worker (Blob URL) and headless by tools/verify.mjs in Node.
 * Internal units: mm, N, MPa, s, degC (K only inside the Anand model).
 * ===================================================================== */

/** Every modelling constant lives here (no magic numbers elsewhere). */
const CONST = Object.freeze({
  // ---- property tables -------------------------------------------------
  TGRID_MIN: -80,            // degC, first point of the 1 degC property grid
  TGRID_MAX: 300,            // degC, last point
  T_STRAIN_ORIGIN: 25,       // degC, origin of the cumulative thermal strain F(T)
  KELVIN: 273.15,
  CTE_INTEGRATION_SUBSTEPS: 8, // Simpson sub-intervals per 1 degC step
  // ---- material modelling ---------------------------------------------
  UNBORN_SCALE: 1e-6,        // stiffness factor of not-yet-born materials
  NU_MAX_GLOBAL: 0.45,       // Poisson clamp in the global incompatible-mode hexes
  NU_MAX_SUBMODEL: 0.49,     // Poisson clamp in the B-bar submodel
  SIGMOID_W_DEFAULT: 8,      // degC, E(T) glass-transition width
  CTE_SMOOTH_DELTA: 3,       // degC, logistic smoothing of the bilinear CTE
  SOLDER_MOLTEN_FRACTION: 0.01, // solder E above solidus = 1 % of E(solidus)
  LAYERED_PLANE_STRESS: true,   // continuum-shell sub-layer stiffness in the layered substrate bands
  GPA: 1000,                 // MPa per GPa
  PPM: 1e-6,
  // ---- mesher -------------------------------------------------------------
  FEATURE_SNAP_TOL: 0.010,   // mm, in-plane feature lines closer than this are merged
  PLANE_MERGE_TOL: 0.001,    // mm, z-planes closer than this are merged
  GROWTH_RATIO_MAX: 1.3,
  REFINE_ZONE_FACTOR: 2.0,   // refinement zone = 2 x local die thickness
  MIN_ELEMS_ACROSS_RING: 3,  // fillet width, lid foot, stiffener ring
  SLIVER_FRACTION: 0.125,    // die bands thinner than this x die thickness stay one element layer
  DIE_MIN_LAYERS: 3,
  ASPECT_WARN: 50,
  SIZE_SAMPLES: 256,         // samples per interval for the size-function mapping
  CAP_GROWTH_PAD: 1.03,
  CAP_MAX_ITER: 12,
  CONSTRAINT_SPAN: 0.4,      // 3-2-1 points at 40 % of the smaller half-dimension
  MESH_PRESETS: {
    draft:    { label: 'Draft',    hmin: 0.6,  hmax: 3.0, cap: 30000 },
    standard: { label: 'Standard', hmin: 0.25, hmax: 1.5, cap: 120000 },
    fine:     { label: 'Fine',     hmin: 0.10, hmax: 0.6, cap: 400000 },
  },
  // ---- solver -------------------------------------------------------------
  PCG_TOL: 1e-8,
  PREVIEW_TOL: 1e-5,         // drag preview only (Draft)
  PCG_MAXIT: 2000,
  WARM_START_MAX: 20,
  REBUILD_FACTOR: 2,
  REBUILD_MIN_ITERS: 30,     // never rebuild before this many iterations of a stale preconditioner
  MG_COARSEST_COLS: 9,       // stop semi-coarsening at <= 3 x 3 columns
  MG_COARSEST_DOF: 900,
  CHOL_JITTER: 1e-12,
  IC_SHIFT0: 1e-3,
  IC_SHIFT_MAX: 1,
  // ---- post-processing ------------------------------------------------------
  DIE_EDGE_BAND: 0.5,        // mm excluded from the die interior peak
  CORNER_PATCH: 0.1,         // mm, 100 um x 100 um averaging patch
  PATCH_SAMPLES: 5,          // samples per side inside a patch
  TRACTION_PATCH: 0.05,      // mm, 50 um x 50 um underfill traction patch
  TRACTION_SAMPLES: 3,
  DIAG_SAMPLES: 201,
  GF_PER_N: 101.97162,
  // ---- solder fatigue -------------------------------------------------------
  R_GAS: 8.314,
  SCREEN_MAX_BUMPS: 20000,
  SCREEN_KEEP_ROWS: 3,
  SCREEN_CORNER_BLOCK: 10,
  CYCLE_DT_STEP: 10,         // degC between global cycling samples
  CYCLE_DT_FINE: 5,          // degC near a Tg
  CYCLE_TG_BAND: 15,         // degC half-width of the refined window
  REFLOW_DT: 15,             // degC between reflow-sweep samples above the cycling range
  REFLOW_DT_FINE: 10,        // degC near a Tg on the reflow sweep
  RAMP_MAX_DT: 5,            // degC per time step on ramps
  DWELL_MIN_STEPS: 10,
  INELASTIC_STEP_MAX: 2e-4,  // equivalent inelastic strain increment per step
  SUB_T_AVG: 0.025,          // mm, interface averaging layer
  SUB_MARGIN: 0.05,          // mm, submodel extends 50 um into substrate and die
  SUB_NEWTON_MAXIT: 25,
  SUB_RES_TOL: 1e-6,
  SUB_DU_TOL: 1e-8,
  STABILIZATION_WARN: 0.05,
  ANAND_NEWTON_MAXIT: 60,
  ANAND_TOL: 1e-11,
  // ---- life models ----------------------------------------------------------
  SYED_CW: 0.00165,          // MPa^-1 (Syed ECTC 2004 via Amalu et al. 2015)
  SYED_CSTRAIN: 0.0513,
  // ---- sensitivity ----------------------------------------------------------
  SENS_REL: 0.10,
  SENS_DT: 10,
  // ---- guard rails (hard bounds) ---------------------------------------------
  BOUNDS: {
    dieT: [0.05, 1.5], standoff: [0.020, 0.200], coreT: [0.1, 2.0],
    cte: [0, 300], modulusGPa: [0.0001, 500], nu: [0, 0.49],
  },
});
