"use client";
import { useState } from "react";
import { DEFAULT_ASSETS, BUCKET_CONSTRAINTS, CORRELATION_MATRIX, DEFAULT_CURRENCY_CONSTRAINT, LEVERAGE_VOL_MULTIPLIER, Asset, BucketType, BucketConstraint, CurrencyConstraint, OptimizationGoal } from "@/lib/assets";
import { runOptimization, OptimizationResult, CorrMatrix } from "@/lib/optimizer";
import AssetInputPanel, { TickerFetchStatus, TickerFetchMeta } from "@/components/AssetInputPanel";
import { CorrMeta } from "@/components/CorrelationMatrixPanel";
import ConstraintPanel from "@/components/ConstraintPanel";
import ResultPanel from "@/components/ResultPanel";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, ChevronLeft, BarChart3 } from "lucide-react";

const DEFAULT_WEIGHTS: Record<string, number> = {
  VOO: 20, "0050": 15, QQQ: 15, "00631L": 10, VEA: 5, VWO: 5,
  IBIT: 2, IAU: 8, SGOV: 15, Cash: 5,
};

const DEFAULT_PER_ASSET_MIN: Record<string, number> = Object.fromEntries(
  DEFAULT_ASSETS.map(a => [a.id, a.bucket === "alternative" ? 2 : 5])
);

const NON_FETCHABLE = new Set(["Cash", "cash", "現金", "台幣現金", "USDCash", "美金現金"]);

const STEPS = ["設定資產", "設定約束", "最佳化結果"];

export default function Home() {
  const [step, setStep] = useState(0);
  const [assets, setAssets] = useState<Asset[]>(DEFAULT_ASSETS);
  const [currentWeights, setCurrentWeights] = useState<Record<string, number>>(DEFAULT_WEIGHTS);
  const [constraints, setConstraints] = useState<BucketConstraint[]>(BUCKET_CONSTRAINTS);
  const [corrMatrix, setCorrMatrix] = useState<CorrMatrix>(JSON.parse(JSON.stringify(CORRELATION_MATRIX)));
  const [goal, setGoal] = useState<OptimizationGoal>("max_sharpe");
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [tickerStatus, setTickerStatus] = useState<TickerFetchStatus>({});
  const [tickerMeta, setTickerMeta]     = useState<TickerFetchMeta>({});
  const [corrMeta, setCorrMeta]         = useState<CorrMeta>({});
  const [fetchPeriod, setFetchPeriod]   = useState<string | null>(null);
  const [currencyConstraint, setCurrencyConstraint] = useState<CurrencyConstraint>(DEFAULT_CURRENCY_CONSTRAINT);
  const [perAssetMin, setPerAssetMin] = useState<Record<string, number>>(DEFAULT_PER_ASSET_MIN);
  const [riskFreeRate, setRiskFreeRate] = useState(2.0);

  function updateWeight(id: string, val: number) {
    setCurrentWeights(w => ({ ...w, [id]: val }));
  }

  function updateConstraint(bucket: string, field: "min" | "max", val: number) {
    setConstraints(cs => cs.map(c => c.bucket === bucket ? { ...c, [field]: val } : c));
  }

  function handleAddAsset(bucket: BucketType, tempId: string) {
    const newAsset: Asset = {
      id: tempId, name: tempId, bucket,
      currency: "USD",
      liquid: false,
      leveraged: false,
      expectedReturn: 8.0, volatility: 15.0,
      defaultReturn: 8.0, defaultVolatility: 15.0,
    };
    setAssets(prev => {
      // Insert after the last existing asset of the same bucket so the matrix order matches
      let insertIdx = prev.length;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].bucket === bucket) { insertIdx = i + 1; break; }
      }
      return [...prev.slice(0, insertIdx), newAsset, ...prev.slice(insertIdx)];
    });
    setCurrentWeights(prev => ({ ...prev, [tempId]: 0 }));
    setCorrMatrix(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as CorrMatrix;
      next[tempId] = {};
      for (const key of Object.keys(next)) {
        if (key !== tempId) { next[tempId][key] = 0; next[key][tempId] = 0; }
      }
      next[tempId][tempId] = 1;
      return next;
    });
  }

  function handleRemoveAsset(id: string) {
    setAssets(prev => prev.filter(a => a.id !== id));
    setCurrentWeights(prev => { const n = { ...prev }; delete n[id]; return n; });
    setCorrMatrix(prev => {
      const next: CorrMatrix = {};
      for (const [rk, row] of Object.entries(prev)) {
        if (rk === id) continue;
        next[rk] = {};
        for (const [ck, val] of Object.entries(row)) {
          if (ck !== id) next[rk][ck] = val;
        }
      }
      return next;
    });
    setTickerStatus(prev => { const n = { ...prev }; delete n[id]; return n; });
    setTickerMeta(prev => { const n = { ...prev }; delete n[id]; return n; });
    setPerAssetMin(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  function handleTickerChange(oldId: string, newId: string) {
    // Update asset id/name
    setAssets(prev => prev.map(a => a.id === oldId ? { ...a, id: newId, name: newId } : a));
    // Update weight key
    setCurrentWeights(prev => {
      const next = { ...prev };
      next[newId] = next[oldId] ?? 0;
      delete next[oldId];
      return next;
    });
    // Rename correlation matrix key (row + column)
    setCorrMatrix(prev => {
      const next: CorrMatrix = {};
      for (const [rowKey, row] of Object.entries(prev)) {
        const newRowKey = rowKey === oldId ? newId : rowKey;
        next[newRowKey] = {};
        for (const [colKey, val] of Object.entries(row)) {
          const newColKey = colKey === oldId ? newId : colKey;
          next[newRowKey][newColKey] = val;
        }
      }
      // Ensure self-correlation exists for new id
      if (!next[newId]) next[newId] = {};
      next[newId][newId] = 1;
      return next;
    });
    // Clear fetch status for old ticker
    setTickerStatus(prev => {
      const next = { ...prev };
      delete next[oldId];
      return next;
    });
  }

  async function handleFetchHistorical() {
    setIsFetching(true);
    const tickers = assets.map(a => a.id);
    // Set all fetchable tickers to loading
    const initial: TickerFetchStatus = {};
    tickers.forEach(t => (initial[t] = NON_FETCHABLE.has(t) ? "skipped" : "loading"));
    setTickerStatus(initial);

    try {
      const res = await fetch("/api/historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      const data = await res.json() as {
        results: Array<{
          ticker: string;
          annualizedReturn?: number;
          annualizedVolatility?: number;
          error?: string;
          skipped?: boolean;
          ownMonths?: number;
          totalMonths?: number;
          proxyTicker?: string;
          proxyMonths?: number;
          proxyAutoDiscovered?: boolean;
          resolvedSymbol?: string;
        }>;
        correlations?: Record<string, Record<string, number>>;
        correlationMeta?: Record<string, Record<string, { months: number; simulated: boolean }>>;
      };

      console.log("[historical] results:", data.results);

      const statusNext: TickerFetchStatus = { ...initial };
      const metaNext: TickerFetchMeta = {};
      setAssets(prev => prev.map(a => {
        const r = data.results.find(x => x.ticker === a.id);
        if (!r || r.skipped) { statusNext[a.id] = "skipped"; return a; }
        if (r.error) {
          console.warn(`[historical] ${a.id} error:`, r.error);
          statusNext[a.id] = "error";
          return a;
        }
        statusNext[a.id] = "success";
        metaNext[a.id] = {
          totalMonths: r.totalMonths ?? r.ownMonths,
          commonMonths: r.ownMonths,
          resolvedSymbol: r.resolvedSymbol,
          proxyTicker: r.proxyTicker,
          proxyMonths: r.proxyMonths,
          proxyAutoDiscovered: r.proxyAutoDiscovered,
        };
        const rawVol = r.annualizedVolatility ?? a.volatility;
        return {
          ...a,
          expectedReturn: r.annualizedReturn ?? a.expectedReturn,
          volatility: a.leveraged ? parseFloat((rawVol * LEVERAGE_VOL_MULTIPLIER).toFixed(2)) : rawVol,
        };
      }));
      setTickerStatus(statusNext);
      setTickerMeta(metaNext);

      // Update correlation matrix and meta
      if (data.correlations) {
        setCorrMatrix(prev => {
          const next = JSON.parse(JSON.stringify(prev)) as CorrMatrix;
          for (const [ti, row] of Object.entries(data.correlations!)) {
            if (!next[ti]) next[ti] = {};
            for (const [tj, val] of Object.entries(row)) {
              next[ti][tj] = val;
              if (!next[tj]) next[tj] = {};
              next[tj][ti] = val;
            }
          }
          return next;
        });
      }
      if (data.correlationMeta) setCorrMeta(data.correlationMeta);

      // Build fetchPeriod summary: use totalMonths (including proxy extension)
      const successResults = data.results.filter(r => !r.skipped && !r.error);
      const successCount = successResults.length;
      const proxyCount = successResults.filter(r => r.proxyMonths && r.proxyMonths > 0).length;
      const allTotals = successResults.map(r => r.totalMonths ?? r.ownMonths ?? 0).filter(m => m > 0);
      if (successCount > 0 && allTotals.length > 0) {
        const minMonths = Math.min(...allTotals);
        const maxMonths = Math.max(...allTotals);
        const proxySuffix = proxyCount > 0 ? ` · ${proxyCount} 個標的含代理延伸（*）` : "";
        setFetchPeriod(`${successCount} 個標的成功 · 各自月數 ${minMonths}–${maxMonths} 個月${proxySuffix}`);
      }
    } catch (e) {
      console.error("[historical fetch] network error:", e);
      const errStatus: TickerFetchStatus = {};
      assets.forEach(a => (errStatus[a.id] = NON_FETCHABLE.has(a.id) ? "skipped" : "error"));
      setTickerStatus(errStatus);
    } finally {
      setIsFetching(false);
    }
  }

  async function handleOptimize() {
    setRunning(true);
    await new Promise(r => setTimeout(r, 50));
    const res = runOptimization(assets, currentWeights, corrMatrix, constraints, goal, currencyConstraint, perAssetMin, riskFreeRate);
    setResult(res);
    setRunning(false);
    setStep(2);
  }

  const totalWeight = Object.values(currentWeights).reduce((s, v) => s + v, 0);
  const weightOk = Math.abs(totalWeight - 100) <= 0.5;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <BarChart3 className="text-primary" size={24} />
            <div>
              <h1 className="font-bold text-lg leading-tight">資產配置比例最佳化</h1>
              <p className="text-xs text-muted-foreground">五桶框架 · 現代投資組合理論</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                onClick={() => (i < step || (i === 2 && result)) ? setStep(i) : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  i === step
                    ? "bg-primary text-primary-foreground"
                    : i < step || (i === 2 && result)
                    ? "bg-muted text-foreground hover:bg-muted/80 cursor-pointer"
                    : "bg-muted/40 text-muted-foreground cursor-default"
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-background/20 flex items-center justify-center text-xs">{i + 1}</span>
                {s}
              </button>
              {i < STEPS.length - 1 && <ChevronRight size={16} className="text-muted-foreground" />}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <AssetInputPanel
              assets={assets}
              currentWeights={currentWeights}
              perAssetMin={perAssetMin}
              tickerStatus={tickerStatus}
              tickerMeta={tickerMeta}
              isFetching={isFetching}
              fetchPeriod={fetchPeriod}
              corrMatrix={corrMatrix}
              corrMeta={corrMeta}
              onChange={setAssets}
              onWeightChange={updateWeight}
              onMinWeightChange={(id, val) => setPerAssetMin(prev => ({ ...prev, [id]: val }))}
              onTickerChange={handleTickerChange}
              onFetch={handleFetchHistorical}
              onAddAsset={handleAddAsset}
              onRemoveAsset={handleRemoveAsset}
              onCorrMatrixChange={setCorrMatrix}
              onCorrMetaReset={() => setCorrMeta({})}
            />
            <div className="flex items-center justify-between gap-2">
              {!weightOk && (
                <p className="text-sm text-red-500">比例總計需等於 100%（目前 {totalWeight.toFixed(1)}%）</p>
              )}
              <div className="flex items-center gap-2 ml-auto">
                {result && (
                  <Button variant="outline" onClick={() => setStep(2)}>
                    查看最新結果 <ChevronRight size={16} className="ml-1" />
                  </Button>
                )}
                <Button onClick={() => setStep(1)} disabled={!weightOk}>
                  下一步：設定約束 <ChevronRight size={16} className="ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <ConstraintPanel
              constraints={constraints}
              goal={goal}
              currencyConstraint={currencyConstraint}
              riskFreeRate={riskFreeRate}
              onConstraintChange={updateConstraint}
              onGoalChange={setGoal}
              onCurrencyConstraintChange={setCurrencyConstraint}
              onRiskFreeRateChange={setRiskFreeRate}
            />
            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ChevronLeft size={16} className="mr-1" /> 上一步
              </Button>
              <div className="flex items-center gap-2">
                {result && (
                  <Button variant="outline" onClick={() => setStep(2)}>
                    查看最新結果 <ChevronRight size={16} className="ml-1" />
                  </Button>
                )}
                <Button onClick={handleOptimize} disabled={running}>
                  {running ? <><Loader2 size={16} className="mr-2 animate-spin" /> 計算中...</> : "開始最佳化"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && result && (
          <div className="space-y-4">
            <ResultPanel result={result} assets={assets} />
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft size={16} className="mr-1" /> 調整參數
              </Button>
              <Button onClick={handleOptimize} disabled={running} variant="secondary">
                {running ? <><Loader2 size={16} className="mr-2 animate-spin" /> 重新計算...</> : "重新最佳化"}
              </Button>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t mt-16">
        <div className="max-w-4xl mx-auto px-6 py-4 text-xs text-muted-foreground">
          本工具使用隨機搜尋演算法在五桶框架約束下最佳化投資組合比例。
          預期報酬與波動率為歷史估計值，不代表未來績效。本工具僅供教育與輔助決策使用，不構成投資建議。
        </div>
      </footer>
    </div>
  );
}
