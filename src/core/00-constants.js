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
  COLUMN_INPLANE_FRACTION: 1e-3, // in-plane stiffness of the solder column phase, fraction of its axial stiffness (numerical floor)
  // stacked-module process stages, before the substrate stage S0 (stage numbers; a material is born in its stage)
  STAGE: Object.freeze({ DDI: -3, WCUF: -2, MOLD: -1 }),
  // ---- incremental thermoelastic path (Section 6.5, as amended) -----------
  INC_DT_MAX: 30,            // degC, largest temperature step of the thermal path
  INC_DT_TG: 10,             // degC, largest step within INC_TG_BAND of any Tg
  INC_TG_BAND: 15,           // degC half-width of the refined window around each Tg
  GPA: 1000,                 // MPa per GPa
  PPM: 1e-6,
  // ---- mesher -------------------------------------------------------------
  FEATURE_SNAP_TOL: 0.010,   // mm, in-plane feature lines closer than this are merged
  PLANE_MERGE_TOL: 0.001,    // mm, z-planes closer than this are merged
  GROWTH_RATIO_MAX: 1.3,
  REFINE_ZONE_FACTOR: 2.0,   // refinement zone = 2 x local die thickness
  MIN_ELEMS_ACROSS_RING: 3,  // lid foot, stiffener ring
  RING_EDGE_ZONE: 0,         // refinement zone at lid foot and stiffener edges (x ring thickness): grading starts at the edge
  SLIVER_FRACTION: 0.125,    // die bands thinner than this x die thickness start at one element layer, others at two
  MIN_ELEMS_ACROSS_FILLET: 6, // underfill fillet width, at most (see FILLET_COL_MIN_FRACTION)
  FILLET_COL_MIN_FRACTION: 0.5, // fillet columns no narrower than this x h_min (at least MIN_ELEMS_ACROSS_RING)
  MIN_LAYERS_PER_REGION: 4,  // element layers through every region's thickness (each substrate group too)
  FILLET_FILL_SAMPLES: 4,    // in-plane samples per side for the filled fraction of a fillet cell
  FILLET_FILL_MIN: 0.05,     // fillet cells filled less than this are left void
  ASPECT_WARN: 50,
  CHIPLET_GAP_WARN: 0.05,    // mm, chiplet-to-chiplet gaps below this warn of wafer underfill or mold flow risk
  SIZE_SAMPLES: 256,         // samples per interval for the size-function mapping
  CAP_GROWTH_PAD: 1.03,
  CAP_MAX_ITER: 12,
  CONSTRAINT_SPAN: 0.4,      // 3-2-1 points at 40 % of the smaller half-dimension
  MESH_PRESETS: {
    draft:    { label: 'Draft',    hmin: 0.6,  hmax: 3.0, cap: 75000 },
    standard: { label: 'Standard', hmin: 0.25, hmax: 1.5, cap: 330000 },
    fine:     { label: 'Fine',     hmin: 0.10, hmax: 0.6, cap: 850000 },
  },
  // ---- solver -------------------------------------------------------------
  PCG_TOL: 1e-8,
  PCG_MAXIT: 2000,
  WARM_START_MAX: 20,
  REBUILD_FACTOR: 2,         // rebuild the preconditioner when a solve needs this many times its iterations per decade of residual reduction right after the build
  REBUILD_MIN_ITERS: 30,     // never rebuild before this many iterations of a stale preconditioner
  SWEEP_BLOCKS_PER_WORKER: 3, // thermal-path steps go to the workers in about this many blocks each, taken from a shared queue
  SWEEP_BLOCK_MIN: 2,        // steps per block at least (consecutive steps warm-start each other)
  // ---- live progress (run details panel and status dot) -------------------
  LIVE_INTERVAL_MS: 1000,    // solvers and submodels report their state at most this often
  LIVE_HIST_POINTS: 100,     // residual history points sent with each report
  LIVE_STALL_ITERS: 500,     // red: the residual has not halved over this many PCG iterations
  LIVE_STALL_RATIO: 0.5,
  LIVE_MAXIT_FRAC: 0.9,      // red: a solve attempt has used this fraction of PCG_MAXIT
  LIVE_SLOW_FACTOR: 3,       // orange: a solve needs this many times the run's average iterations
  LIVE_SLOW_ITERS: 600,      // orange, while fewer than LIVE_SLOW_MIN_SOLVES solves have finished
  LIVE_SLOW_MIN_SOLVES: 3,
  LIVE_QUIET_MS: 30000,      // orange: nothing at all heard from the run for this long
  LIVE_STUCK_MS: 60000,      // red: a worker inside a solve or submodel silent for this long
  LIVE_CUTBACK_MS: 5000,     // orange for this long after a submodel step cutback
  MG_COARSEST_COLS: 9,       // stop semi-coarsening at <= 3 x 3 columns
  MG_COARSEST_DOF: 900,
  MG_MIN_COARSENING: 0.7,    // stop coarsening when a level would keep more than this fraction of the columns
  CHOL_JITTER: 1e-12,
  IC_SHIFT0: 1e-3,
  IC_SHIFT_MAX: 1,
  // ---- post-processing ------------------------------------------------------
  DIE_EDGE_BAND: 0.5,        // mm excluded from the die interior peak
  CORNER_PATCH: 0.1,         // mm, 100 um x 100 um averaging patch
  PATCH_SAMPLES: 5,          // samples per side inside a patch
  TRACTION_PATCH: 0.05,      // mm, 50 um x 50 um underfill traction patch
  TRACTION_SAMPLES: 3,
  SECTION_MIN_LENGTH: 0.01, // mm, shortest section line
  DIAG_SAMPLES: 201,
  SIGN_MARGINAL: 0.25,       // |AB_max + AB_min + CD_max + CD_min| / |C| below this flags a marginal JEITA sign
  GF_PER_N: 101.97162,
  // ---- solder fatigue -------------------------------------------------------
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
  SUB_INNER_TOL: 1e-8,       // floor of the inexact-Newton inner PCG tolerance
  STABILIZATION_WARN: 0.05,
  COLUMN_NEWTON_MAXIT: 20,   // in-plane Newton iterations of a free-standing solder column (screening)
  COLUMN_STRESS_TOL: 1e-3,   // in-plane stress of the column relative to its axial and shear stress (at least 1 MPa); dW unchanged to 6 digits against 1e-6
  ANAND_NEWTON_MAXIT: 60,
  ANAND_TOL: 1e-11,
  // ---- life models ----------------------------------------------------------
  SYED_CW: 0.00165,          // MPa^-1 (Syed ECTC 2004 via Amalu et al. 2015)
  SYED_CSTRAIN: 0.0513,
  // ---- sensitivity ----------------------------------------------------------
  SENS_REL: 0.10,
  SENS_DT: 10,
  // ---- results file (.fcbgares) ---------------------------------------------
  RESULTS_FILE_MAGIC: 'FCBGARES',  // first 8 bytes of a results file
  RESULTS_FILE_VERSION: 2,         // format version (2: stacked modules in the configuration and the results); a file from a newer version is refused
  RESULTS_FILE_ALIGN: 8,           // bytes; alignment of each typed array in the data block
  RESULTS_FILE_EXT: '.fcbgares',
  RESULTS_FILE_CHUNK_BYTES: 64 * 1048576,  // step increments per message between the page and a worker (the desktop app's page-to-process channel limits one message)
  // ---- guard rails (hard bounds) ---------------------------------------------
  BOUNDS: {
    dieT: [0.05, 1.5], standoff: [0.020, 0.200], coreT: [0.1, 2.0], baseT: [0.02, 1.5], ddiStandoff: [0.005, 0.100],
    cte: [0, 300], modulusGPa: [0.0001, 500], nu: [0, 0.49],
  },
});
