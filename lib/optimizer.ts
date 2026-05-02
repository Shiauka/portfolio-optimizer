import { Asset, BucketConstraint, CurrencyConstraint, OptimizationGoal } from "./assets";

export type CorrMatrix = Record<string, Record<string, number>>;

export interface PortfolioMetrics {
  expectedReturn: number;
  volatility: number;
  sharpe: number;
  weights: Record<string, number>;
}

export type FrontierPoint = { risk: number; return: number; sharpe: number; weights: Record<string, number> };

export interface OptimizationResult {
  optimal: PortfolioMetrics;
  current: PortfolioMetrics;
  efficientFrontier: FrontierPoint[];
  riskFreeRate: number;
}

function portfolioMetrics(
  weights: number[],
  assets: Asset[],
  corrMatrix: CorrMatrix
): { ret: number; vol: number } {
  const n = assets.length;
  const w = weights.map(v => v / 100);
  let ret = 0;
  for (let i = 0; i < n; i++) ret += w[i] * assets[i].expectedReturn;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const corr = corrMatrix[assets[i].id]?.[assets[j].id] ?? (i === j ? 1 : 0);
      variance += w[i] * w[j] * assets[i].volatility * assets[j].volatility * corr;
    }
  }
  return { ret, vol: Math.sqrt(Math.max(0, variance)) };
}

function sharpe(ret: number, vol: number, rfr: number): number {
  return vol > 0 ? (ret - rfr) / vol : 0;
}

function projectToConstraints(
  w: number[],
  assets: Asset[],
  bucketConstraints: BucketConstraint[],
  cc: CurrencyConstraint | null,
  perAssetMin: number[]
): number[] {
  const result = w.map((x, i) => Math.max(perAssetMin[i] ?? 0, Math.min(100, x)));

  for (let iter = 0; iter < 30; iter++) {
    // Per-asset minimums: if any asset is below its floor, lift it and
    // proportionally reduce the others.
    for (let i = 0; i < assets.length; i++) {
      const floor = perAssetMin[i] ?? 0;
      if (result[i] < floor) {
        const diff = floor - result[i];
        result[i] = floor;
        const otherIdx = assets.map((_, j) => j).filter(j => j !== i && result[j] > 0);
        const othersSum = otherIdx.reduce((s, j) => s + result[j], 0);
        if (othersSum > 0) {
          otherIdx.forEach(j => result[j] = Math.max(0, result[j] - diff * result[j] / othersSum));
        }
      }
    }

    // Bucket constraints
    for (const bc of bucketConstraints) {
      const indices = assets.map((a, i) => a.bucket === bc.bucket ? i : -1).filter(i => i >= 0);
      const bucketSum = indices.reduce((s, i) => s + result[i], 0);
      if (bucketSum < bc.min) {
        const diff = bc.min - bucketSum;
        indices.forEach(i => (result[i] += diff / indices.length));
      } else if (bucketSum > bc.max) {
        const scale = bc.max / bucketSum;
        indices.forEach(i => (result[i] *= scale));
        const excess = bucketSum - bc.max;
        const otherIdx = assets.map((_, i) => i).filter(i => !indices.includes(i));
        if (otherIdx.length > 0) otherIdx.forEach(i => (result[i] += excess / otherIdx.length));
      }
    }

    // Currency constraint: only non-liquid investment assets count toward the TWD/USD
    // ratio. Liquid buffers (Cash, USDCash, SGOV) are excluded so the optimizer
    // cannot satisfy "TWD ≥ X%" by piling into 台幣現金 instead of 0050/00631L.
    if (cc) {
      const total = result.reduce((a, b) => a + b, 0);
      if (total > 0) {
        const twdEqIdx = assets.map((a, i) => a.currency === "TWD" && !a.liquid ? i : -1).filter(i => i >= 0);
        const usdEqIdx = assets.map((a, i) => a.currency === "USD" && !a.liquid ? i : -1).filter(i => i >= 0);
        const twdSum = twdEqIdx.reduce((s, i) => s + result[i], 0);
        const twdPct = twdSum / total * 100;

        if (twdPct < cc.twd_min && twdEqIdx.length > 0 && usdEqIdx.length > 0) {
          const diff = (cc.twd_min / 100 * total) - twdSum;
          twdEqIdx.forEach(i => result[i] += diff / twdEqIdx.length);
          usdEqIdx.forEach(i => result[i] = Math.max(0, result[i] - diff / usdEqIdx.length));
        } else if (twdPct > cc.twd_max && twdEqIdx.length > 0 && usdEqIdx.length > 0) {
          const diff = twdSum - (cc.twd_max / 100 * total);
          twdEqIdx.forEach(i => result[i] = Math.max(0, result[i] - diff / twdEqIdx.length));
          usdEqIdx.forEach(i => result[i] += diff / usdEqIdx.length);
        }
      }
    }

    const total = result.reduce((a, b) => a + b, 0);
    if (total > 0) result.forEach((_, i) => (result[i] = result[i] / total * 100));
  }
  return result;
}

function optimize(
  assets: Asset[],
  corrMatrix: CorrMatrix,
  bucketConstraints: BucketConstraint[],
  goal: OptimizationGoal,
  cc: CurrencyConstraint | null = null,
  perAssetMin: number[] = [],
  iterations = 80000,
  rfr = 2.0
): number[] {
  const n = assets.length;
  const mins = perAssetMin.length === n ? perAssetMin : Array(n).fill(0);
  const minSum = mins.reduce((a, b) => a + b, 0);

  function score(w: number[]): number {
    const { ret, vol } = portfolioMetrics(w, assets, corrMatrix);
    if (goal === "max_sharpe") return sharpe(ret, vol, rfr);
    if (goal === "max_return") return ret;
    if (goal === "min_risk")   return -vol;
    return 0;
  }

  function randomWeights(): number[] {
    const remaining = Math.max(0, 100 - minSum);
    const raw = Array.from({ length: n }, () => Math.random());
    const sum = raw.reduce((a, b) => a + b, 0);
    return raw.map((v, i) => mins[i] + (sum > 0 ? v / sum * remaining : 0));
  }

  let best = projectToConstraints(randomWeights(), assets, bucketConstraints, cc, mins);
  let bestScore = score(best);

  for (let i = 0; i < iterations; i++) {
    let candidate: number[];
    if (i % 5 === 0) {
      candidate = projectToConstraints(randomWeights(), assets, bucketConstraints, cc, mins);
    } else {
      const step = 3.0 * Math.exp(-i / iterations * 4);
      candidate = best.map(v => v + (Math.random() - 0.5) * step);
      candidate = projectToConstraints(candidate, assets, bucketConstraints, cc, mins);
    }
    const s = score(candidate);
    if (s > bestScore) { bestScore = s; best = candidate; }
  }
  return best;
}

export function buildPortfolioMetrics(
  weights: number[],
  assets: Asset[],
  corrMatrix: CorrMatrix,
  rfr = 2.0
): PortfolioMetrics {
  const { ret, vol } = portfolioMetrics(weights, assets, corrMatrix);
  const w: Record<string, number> = {};
  assets.forEach((a, i) => (w[a.id] = weights[i]));
  return { expectedReturn: ret, volatility: vol, sharpe: sharpe(ret, vol, rfr), weights: w };
}

export function runOptimization(
  assets: Asset[],
  currentWeights: Record<string, number>,
  corrMatrix: CorrMatrix,
  bucketConstraints: BucketConstraint[],
  goal: OptimizationGoal,
  cc: CurrencyConstraint | null = null,
  perAssetMin: Record<string, number> = {},
  riskFreeRate = 2.0
): OptimizationResult {
  const currentW = assets.map(a => currentWeights[a.id] ?? 0);
  const current = buildPortfolioMetrics(currentW, assets, corrMatrix, riskFreeRate);

  const mins = assets.map(a => perAssetMin[a.id] ?? 0);
  const optimalW = optimize(assets, corrMatrix, bucketConstraints, goal, cc, mins, 80000, riskFreeRate);
  const optimal = buildPortfolioMetrics(optimalW, assets, corrMatrix, riskFreeRate);

  const frontier: FrontierPoint[] = [];
  for (let i = 0; i <= 40; i++) {
    const riskAversion = 0.1 + (i / 40) * 4.9;
    const tempAssets = assets.map(a => ({ ...a, expectedReturn: a.expectedReturn / riskAversion }));
    const w = optimize(tempAssets, corrMatrix, bucketConstraints, "max_sharpe", cc, mins, 15000, riskFreeRate);
    const { ret, vol } = portfolioMetrics(w, assets, corrMatrix);
    const wRecord: Record<string, number> = {};
    assets.forEach((a, idx) => (wRecord[a.id] = parseFloat(w[idx].toFixed(1))));
    frontier.push({ risk: parseFloat(vol.toFixed(2)), return: parseFloat(ret.toFixed(2)), sharpe: parseFloat(sharpe(ret, vol, riskFreeRate).toFixed(3)), weights: wRecord });
  }

  const seen = new Set<string>();
  const cleanFrontier = frontier
    .filter(p => { const k = `${p.risk}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.risk - b.risk);

  return { optimal, current, efficientFrontier: cleanFrontier, riskFreeRate };
}
