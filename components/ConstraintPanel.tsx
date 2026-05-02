"use client";
import { useState } from "react";
import { BucketConstraint, CurrencyConstraint, OptimizationGoal } from "@/lib/assets";

interface Props {
  constraints: BucketConstraint[];
  goal: OptimizationGoal;
  currencyConstraint: CurrencyConstraint;
  riskFreeRate: number;
  onConstraintChange: (bucket: string, field: "min" | "max", val: number) => void;
  onGoalChange: (goal: OptimizationGoal) => void;
  onCurrencyConstraintChange: (cc: CurrencyConstraint) => void;
  onRiskFreeRateChange: (rfr: number) => void;
}

const GOAL_OPTIONS: { value: OptimizationGoal; label: string; desc: string }[] = [
  { value: "max_sharpe",  label: "最大夏普比率", desc: "報酬/風險比最佳（最常用）" },
  { value: "max_return",  label: "最大報酬",     desc: "在約束內追求最高預期報酬" },
  { value: "min_risk",    label: "最小風險",     desc: "波動率最低的投資組合" },
];

const INPUT_CLS = "w-16 border rounded px-2 py-1 text-sm font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary";

export default function ConstraintPanel({
  constraints, goal, currencyConstraint, riskFreeRate,
  onConstraintChange, onGoalChange, onCurrencyConstraintChange, onRiskFreeRateChange,
}: Props) {
  // Local draft strings — updated freely while typing, committed on blur
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function getDraft(key: string, fallback: number) {
    return key in drafts ? drafts[key] : String(fallback);
  }

  function setDraft(key: string, val: string) {
    setDrafts(d => ({ ...d, [key]: val }));
  }

  function commitBucket(bucket: string, field: "min" | "max", raw: string, bc: BucketConstraint) {
    const parsed = parseInt(raw);
    let v = isNaN(parsed) ? (field === "min" ? bc.min : bc.max) : parsed;
    if (field === "min") v = Math.min(Math.max(0, v), bc.max - 1);
    else                 v = Math.min(Math.max(bc.min + 1, v), 100);
    onConstraintChange(bucket, field, v);
    setDraft(`${bucket}_${field}`, String(v));
  }

  function commitCurrency(field: "twd_min" | "twd_max", raw: string) {
    const parsed = parseInt(raw);
    let v = isNaN(parsed) ? currencyConstraint[field] : parsed;
    if (field === "twd_min") v = Math.min(Math.max(0, v), currencyConstraint.twd_max - 1);
    else                     v = Math.min(Math.max(currencyConstraint.twd_min + 1, v), 100);
    onCurrencyConstraintChange({ ...currencyConstraint, [field]: v });
    setDraft(field, String(v));
  }

  const usd_min = 100 - currencyConstraint.twd_max;
  const usd_max = 100 - currencyConstraint.twd_min;

  return (
    <div className="space-y-6">
      {/* Optimization goal */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm">最佳化目標</h3>
        <div className="grid grid-cols-3 gap-3">
          {GOAL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onGoalChange(opt.value)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                goal === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <p className="font-semibold text-sm">{opt.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Risk-free rate */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm">無風險利率（夏普比率基準）</h3>
        <div className="rounded-lg border p-3 flex items-center justify-between gap-4">
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>夏普比率 = <span className="font-mono">(組合報酬 − 無風險利率) / 波動率</span></p>
            <p>
              <span className="font-semibold text-amber-700">台幣投資人</span>建議使用台幣定存利率 ~<span className="font-mono font-semibold">2.0%</span>；
              以美金為基礎幣別者可使用美國短債殖利率 ~<span className="font-mono font-semibold">4.5%</span>。
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="number" step={0.1} min={0} max={10}
              value={getDraft("rfr", riskFreeRate)}
              onChange={e => setDraft("rfr", e.target.value)}
              onBlur={e => {
                const v = parseFloat(e.target.value);
                const clamped = isNaN(v) ? riskFreeRate : Math.min(10, Math.max(0, parseFloat(v.toFixed(1))));
                onRiskFreeRateChange(clamped);
                setDraft("rfr", String(clamped));
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const v = parseFloat((e.target as HTMLInputElement).value);
                  const clamped = isNaN(v) ? riskFreeRate : Math.min(10, Math.max(0, parseFloat(v.toFixed(1))));
                  onRiskFreeRateChange(clamped);
                  setDraft("rfr", String(clamped));
                }
              }}
              className={INPUT_CLS}
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
      </div>

      {/* Currency ratio constraint */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm">台幣股票資產比例設定</h3>
        <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">帳戶再平衡模型說明</p>
          <p><span className="font-semibold text-green-700">台幣帳戶</span>：0050、00631L 等台灣上市 ETF，以台幣現金做帳戶內再平衡緩衝。</p>
          <p><span className="font-semibold text-blue-700">美金帳戶</span>：VOO、QQQ 等美國上市 ETF，以 SGOV 做帳戶內再平衡緩衝。</p>
          <p className="text-amber-700">
            ⚠ 現金與短債（台幣現金、SGOV）為各帳戶的再平衡緩衝，<strong>不納入</strong>本比例計算，
            避免優化器以現金換匯替代真正的股票配置。
          </p>
        </div>
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold px-1.5 py-0.5 rounded border bg-green-50 text-green-700 border-green-300">TWD</span>
              <span className="font-medium text-sm">台幣股票資產占總組合</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1">
                <label className="text-xs text-muted-foreground">最小</label>
                <input
                  type="number" step={1}
                  value={getDraft("twd_min", currencyConstraint.twd_min)}
                  onChange={e => setDraft("twd_min", e.target.value)}
                  onBlur={e => commitCurrency("twd_min", e.target.value)}
                  onKeyDown={e => e.key === "Enter" && commitCurrency("twd_min", (e.target as HTMLInputElement).value)}
                  className={INPUT_CLS}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <div className="flex items-center gap-1">
                <label className="text-xs text-muted-foreground">最大</label>
                <input
                  type="number" step={1}
                  value={getDraft("twd_max", currencyConstraint.twd_max)}
                  onChange={e => setDraft("twd_max", e.target.value)}
                  onBlur={e => commitCurrency("twd_max", e.target.value)}
                  onKeyDown={e => e.key === "Enter" && commitCurrency("twd_max", (e.target as HTMLInputElement).value)}
                  className={INPUT_CLS}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          <div className="relative h-3 bg-muted rounded-full overflow-hidden flex">
            <div className="h-full bg-blue-400/70" style={{ width: `${usd_min}%` }} />
            <div className="h-full bg-blue-200/70" style={{ width: `${usd_max - usd_min}%` }} />
            <div className="h-full bg-green-200/70" style={{ width: `${currencyConstraint.twd_max - currencyConstraint.twd_min}%` }} />
            <div className="h-full bg-green-500/70" style={{ width: `${currencyConstraint.twd_min}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-400/80 mr-1" />
              美金股票 {usd_min}%–{usd_max}%（+ 緩衝現金另計）
            </span>
            <span>
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500/80 mr-1" />
              台幣股票 {currencyConstraint.twd_min}%–{currencyConstraint.twd_max}%（+ 緩衝現金另計）
            </span>
          </div>
        </div>
      </div>

      {/* Bucket constraints */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm">各桶比例上下限</h3>
        <p className="text-xs text-muted-foreground">設定每個桶在最佳化結果中的允許範圍（%）。</p>
        <div className="space-y-3">
          {constraints.map(bc => (
            <div key={bc.bucket} className="rounded-lg border p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: bc.color }} />
                  <span className="font-medium text-sm">{bc.label}桶</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground">最小</label>
                    <input
                      type="number" step={1}
                      value={getDraft(`${bc.bucket}_min`, bc.min)}
                      onChange={e => setDraft(`${bc.bucket}_min`, e.target.value)}
                      onBlur={e => commitBucket(bc.bucket, "min", e.target.value, bc)}
                      onKeyDown={e => e.key === "Enter" && commitBucket(bc.bucket, "min", (e.target as HTMLInputElement).value, bc)}
                      className={INPUT_CLS}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground">最大</label>
                    <input
                      type="number" step={1}
                      value={getDraft(`${bc.bucket}_max`, bc.max)}
                      onChange={e => setDraft(`${bc.bucket}_max`, e.target.value)}
                      onBlur={e => commitBucket(bc.bucket, "max", e.target.value, bc)}
                      onKeyDown={e => e.key === "Enter" && commitBucket(bc.bucket, "max", (e.target as HTMLInputElement).value, bc)}
                      className={INPUT_CLS}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                </div>
              </div>
              <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                <div className="absolute h-full rounded-full opacity-70"
                  style={{ backgroundColor: bc.color, left: `${bc.min}%`, width: `${bc.max - bc.min}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
