export type BucketType = "core" | "attack" | "diversify" | "alternative" | "defense";

export interface Asset {
  id: string;
  name: string;
  bucket: BucketType;
  currency: "USD" | "TWD";
  // liquid = true: cash / money-market buffers used for within-account rebalancing.
  // These are excluded from the currency ratio constraint so the optimizer doesn't
  // satisfy "TWD ≥ X%" by piling into 台幣現金 instead of 0050/00631L.
  liquid: boolean;
  // leveraged = true: daily-rebalanced leveraged ETF. Historical monthly vol is
  // multiplied by LEVERAGE_VOL_MULTIPLIER after fetch to account for intra-month
  // path dependency that monthly sampling cannot capture.
  leveraged: boolean;
  expectedReturn: number;
  volatility: number;
  defaultReturn: number;
  defaultVolatility: number;
}

// Correction factor applied to fetched vol for daily-leveraged ETFs.
// Monthly adj-close std × √12 underestimates true risk because it misses
// intra-month volatility drag from daily rebalancing.
export const LEVERAGE_VOL_MULTIPLIER = 1.4;

export interface BucketConstraint {
  bucket: BucketType;
  label: string;
  color: string;
  min: number;
  max: number;
  defaultTarget: number;
}

export interface CurrencyConstraint {
  twd_min: number;
  twd_max: number;
}

export const DEFAULT_CURRENCY_CONSTRAINT: CurrencyConstraint = {
  twd_min: 20,
  twd_max: 50,
};

// ── Default return / volatility basis ────────────────────────────────────────
// IMPORTANT: All expectedReturn values are ARITHMETIC annualised returns
// (arithmetic mean of monthly returns × 12), NOT geometric/CAGR.
//
// Arithmetic return = CAGR + σ²/2  (always higher than published CAGR).
// Example: 0050 official CAGR ~12.8%, σ=19% → arithmetic ≈ 12.8% + 1.8% = 14.6%
//
// This is intentional: Markowitz mean-variance optimisation requires the
// arithmetic (expected) return, not the compound growth rate.
//
// Asset        Official CAGR  Arithmetic (+σ²/2)  Proxy period
// ─────────────────────────────────────────────────────────────────────────────
// VOO          ~11% (SPY 32y)  ~12% (+1.1%)        SPY 1993-01
// 0050         ~12.8% (22y)    ~14.5% (+1.8%)      own data since 2003
// QQQ          ~13% (est.)     ~15.5% (+2.2%)      own data since 1999
// 00631L       ~28.9% (10y)    ~31% (+5.1%)        own data since 2014
// VEA          ~5.5% (EFA 24y) ~7% (+1.4%)         EFA 2001-08
// VWO          ~7% (EEM 22y)   ~9% (+2%)           EEM 2003-04
// IBIT         N/A (forward)   ~20% (conservative) BTC-USD 2014-09
// IAU          ~7.5% (25y)     ~8.6% (+1.1%)       own data
// SGOV         ~3% (SHY 23y)   ~4% (+0.1%)         SHY 2002-07
// ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_ASSETS: Asset[] = [
  // S&P 500: SPY 1993-2025 (~32 y); CAGR ~11%; arithmetic = 11% + (14.5²/2)/100 ≈ 12.0%
  { id: "VOO",    name: "VOO",    bucket: "core",        currency: "USD", liquid: false, leveraged: false, expectedReturn: 12.0, volatility: 14.5, defaultReturn: 12.0, defaultVolatility: 14.5 },
  // Taiwan 50: official CAGR since 2003 ~12.8%; arithmetic = 12.8% + (19²/2)/100 ≈ 14.6%
  { id: "0050",   name: "0050",   bucket: "core",        currency: "TWD", liquid: false, leveraged: false, expectedReturn: 14.5, volatility: 19.0, defaultReturn: 14.5, defaultVolatility: 19.0 },
  // Nasdaq 100: QQQ since 1999 (~26 y); estimated CAGR ~13%; arithmetic = 13% + (21²/2)/100 ≈ 15.2%
  { id: "QQQ",    name: "QQQ",    bucket: "attack",      currency: "USD", liquid: false, leveraged: false, expectedReturn: 15.0, volatility: 21.0, defaultReturn: 15.0, defaultVolatility: 21.0 },
  // 2x Taiwan 50: official CAGR since 2014 ~28.9%; arithmetic = 28.9% + (32²/2)/100 ≈ 34%
  // defaultVolatility pre-corrected for daily leverage drag (raw ~32% × 1.4 ≈ 45%)
  { id: "00631L", name: "00631L", bucket: "attack",      currency: "TWD", liquid: false, leveraged: true,  expectedReturn: 31.0, volatility: 45.0, defaultReturn: 31.0, defaultVolatility: 45.0 },
  // Dev ex-US: EFA 2001-2025 (~24 y); EU debt crisis + Japan drag; arithmetic ~6%, vol ~16.5%
  { id: "VEA",    name: "VEA",    bucket: "diversify",   currency: "USD", liquid: false, leveraged: false, expectedReturn:  6.0, volatility: 16.5, defaultReturn:  6.0, defaultVolatility: 16.5 },
  // EM: EEM 2003-2025 (~22 y); early-2000s EM boom + 2015-2024 drag; arithmetic ~7.5%, vol ~20%
  { id: "VWO",    name: "VWO",    bucket: "diversify",   currency: "USD", liquid: false, leveraged: false, expectedReturn:  7.5, volatility: 20.0, defaultReturn:  7.5, defaultVolatility: 20.0 },
  // Bitcoin ETF: BTC-USD 2014-2025 (~11 y); conservative forward 20%; vol ~75% (monthly std ~21% × √12)
  { id: "IBIT",   name: "IBIT",   bucket: "alternative", currency: "USD", liquid: false, leveraged: false, expectedReturn: 20.0, volatility: 75.0, defaultReturn: 20.0, defaultVolatility: 75.0 },
  // Gold: ~25 y; arithmetic ~8%, vol ~15% (CAGR ~280→2600 USD/oz ~2000-2025)
  { id: "IAU",    name: "IAU",    bucket: "alternative", currency: "USD", liquid: false, leveraged: false, expectedReturn:  8.0, volatility: 15.0, defaultReturn:  8.0, defaultVolatility: 15.0 },
  // Ultra-short treasury: SHY 2002-2025 (~23 y) covers zero-rate era; blended avg ~4%; vol ~1.5% (SHY duration)
  { id: "SGOV",   name: "SGOV",   bucket: "defense",     currency: "USD", liquid: true,  leveraged: false, expectedReturn:  4.0, volatility:  1.5, defaultReturn:  4.0, defaultVolatility:  1.5 },
  // 台幣活存/現金：報酬 ~1.5%，波動接近 0
  { id: "Cash",   name: "台幣現金", bucket: "defense",   currency: "TWD", liquid: true,  leveraged: false, expectedReturn:  1.5, volatility:  0.1, defaultReturn:  1.5, defaultVolatility:  0.1 },
];

// ── Correlation matrix ────────────────────────────────────────────────────────
// Basis: Pearson correlation of monthly returns, most-recent 10-year window
// (up to 120 months). Where a ticker's own history is shorter, proxy-extended
// returns (see PROXY_TICKERS) fill the window — e.g. IBIT uses BTC-USD from
// 2015, giving a full 10-year series instead of the 16 months since IBIT IPO.
//
// Design choices:
// • ρ(X, 00631L) ≈ ρ(X, 0050) — correlation is scale-invariant; daily leverage
//   doesn't change direction, only magnitude of returns
// • 0050 ↔ 00631L = 0.93 — near-identical underlying; <1.0 due to monthly path effects
// • IBIT vs equities ~0.20-0.35 — post-2020 risk-asset co-movement, tempered by
//   the pre-2020 period (2015-2019) when BTC was largely uncorrelated to equities
// • SGOV vs major equities = -0.05 to -0.15 — mild flight-to-quality; short duration
//   means less negative correlation than long bonds (TLT would be ~-0.35)
export const CORRELATION_MATRIX: Record<string, Record<string, number>> = {
  //          VOO    0050   QQQ    00631L  VEA    VWO    IBIT   IAU    SGOV   Cash
  VOO:      { VOO:  1.00, "0050":  0.70, QQQ:  0.92, "00631L":  0.70, VEA:  0.83, VWO:  0.74, IBIT:  0.30, IAU:  0.05, SGOV: -0.12, Cash:  0.00 },
  "0050":   { VOO:  0.70, "0050":  1.00, QQQ:  0.72, "00631L":  0.93, VEA:  0.60, VWO:  0.55, IBIT:  0.20, IAU:  0.05, SGOV: -0.03, Cash:  0.05 },
  QQQ:      { VOO:  0.92, "0050":  0.72, QQQ:  1.00, "00631L":  0.72, VEA:  0.76, VWO:  0.67, IBIT:  0.35, IAU: -0.03, SGOV: -0.15, Cash:  0.00 },
  "00631L": { VOO:  0.70, "0050":  0.93, QQQ:  0.72, "00631L":  1.00, VEA:  0.60, VWO:  0.55, IBIT:  0.20, IAU:  0.05, SGOV: -0.03, Cash:  0.05 },
  VEA:      { VOO:  0.83, "0050":  0.60, QQQ:  0.76, "00631L":  0.60, VEA:  1.00, VWO:  0.83, IBIT:  0.20, IAU:  0.10, SGOV: -0.05, Cash:  0.00 },
  VWO:      { VOO:  0.74, "0050":  0.55, QQQ:  0.67, "00631L":  0.55, VEA:  0.83, VWO:  1.00, IBIT:  0.25, IAU:  0.12, SGOV: -0.03, Cash:  0.00 },
  IBIT:     { VOO:  0.30, "0050":  0.20, QQQ:  0.35, "00631L":  0.20, VEA:  0.20, VWO:  0.25, IBIT:  1.00, IAU:  0.15, SGOV: -0.02, Cash:  0.00 },
  IAU:      { VOO:  0.05, "0050":  0.05, QQQ: -0.03, "00631L":  0.05, VEA:  0.10, VWO:  0.12, IBIT:  0.15, IAU:  1.00, SGOV:  0.12, Cash:  0.00 },
  SGOV:     { VOO: -0.12, "0050": -0.03, QQQ: -0.15, "00631L": -0.03, VEA: -0.05, VWO: -0.03, IBIT: -0.02, IAU:  0.12, SGOV:  1.00, Cash:  0.25 },
  Cash:     { VOO:  0.00, "0050":  0.05, QQQ:  0.00, "00631L":  0.05, VEA:  0.00, VWO:  0.00, IBIT:  0.00, IAU:  0.00, SGOV:  0.25, Cash:  1.00 },
};

export const BUCKET_CONSTRAINTS: BucketConstraint[] = [
  { bucket: "core",        label: "核心",  color: "#3B82F6", min: 25, max: 50, defaultTarget: 35 },
  { bucket: "attack",      label: "攻擊",  color: "#EF4444", min: 15, max: 45, defaultTarget: 30 },
  { bucket: "diversify",   label: "分散",  color: "#8B5CF6", min: 5,  max: 25, defaultTarget: 15 },
  { bucket: "alternative", label: "另類",  color: "#F59E0B", min: 0,  max: 15, defaultTarget: 5  },
  { bucket: "defense",     label: "防禦",  color: "#10B981", min: 5,  max: 30, defaultTarget: 15 },
];

export type OptimizationGoal = "max_sharpe" | "max_return" | "min_risk";

export const RISK_FREE_RATE = 2.0;
