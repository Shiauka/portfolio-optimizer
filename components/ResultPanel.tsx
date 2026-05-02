"use client";
import { useState } from "react";
import { OptimizationResult, FrontierPoint } from "@/lib/optimizer";
import { Asset, BUCKET_CONSTRAINTS } from "@/lib/assets";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceDot, BarChart, Bar, Cell, LabelList,
} from "recharts";
import { TrendingUp, TrendingDown, RotateCcw, Maximize2, Minimize2, List, BarChart2 } from "lucide-react";

interface Props {
  result: OptimizationResult;
  assets: Asset[];
}

const BUCKET_COLOR: Record<string, string> = Object.fromEntries(
  BUCKET_CONSTRAINTS.map(b => [b.bucket, b.color])
);
const BUCKET_LABEL: Record<string, string> = Object.fromEntries(
  BUCKET_CONSTRAINTS.map(b => [b.bucket, b.label])
);

export default function ResultPanel({ result, assets }: Props) {
  const { optimal, current, efficientFrontier, riskFreeRate } = result;
  const [selected, setSelected] = useState<FrontierPoint | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [frontierView, setFrontierView] = useState<"chart" | "table">("chart");

  const displayWeights = selected?.weights ?? optimal.weights;
  const displayLabel = selected
    ? `報酬 ${selected.return}% · 波動 ${selected.risk}% · 夏普 ${selected.sharpe}`
    : "最佳配置（最大夏普）";

  const rows = assets.map(a => ({
    ...a,
    currentW: current.weights[a.id] ?? 0,
    optimalW: optimal.weights[a.id] ?? 0,
    displayW: displayWeights[a.id] ?? 0,
    diff: (optimal.weights[a.id] ?? 0) - (current.weights[a.id] ?? 0),
  }));

  // Index of the max-Sharpe point on the frontier (may differ from `optimal`
  // due to frontier sampling resolution vs the full 80k-iteration optimizer).
  const optimalFrontierIdx = efficientFrontier.reduce(
    (best, p, i) => (p.sharpe > efficientFrontier[best].sharpe ? i : best),
    0
  );

  function toggleSelected(p: FrontierPoint) {
    setSelected(prev =>
      prev?.risk === p.risk && prev?.return === p.return ? null : p
    );
  }

  function metricCard(label: string, curr: number, opt: number, unit = "%", decimals = 1) {
    const better = label === "年化波動率" ? opt < curr : opt > curr;
    return (
      <div className="rounded-lg border p-4 space-y-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-end gap-3">
          <div>
            <p className="text-xs text-muted-foreground">目前</p>
            <p className="text-lg font-mono font-semibold">{curr.toFixed(decimals)}{unit}</p>
          </div>
          <div className={better ? "text-emerald-600" : "text-red-500"}>
            {better ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">最佳</p>
            <p className={`text-lg font-mono font-semibold ${better ? "text-emerald-600" : "text-red-500"}`}>
              {opt.toFixed(decimals)}{unit}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function FrontierDot(props: any) {
    const { cx, cy, payload } = props as { cx: number; cy: number; payload: FrontierPoint };
    if (!payload) return null;
    const isSel = selected?.risk === payload.risk && selected?.return === payload.return;
    return (
      <circle
        cx={cx} cy={cy}
        r={isSel ? 7 : 4}
        fill={isSel ? "#6366f1" : "#94a3b8"}
        stroke={isSel ? "#fff" : "none"}
        strokeWidth={2}
        style={{ cursor: "pointer" }}
      />
    );
  }

  const chartHeight = expanded ? 420 : 280;

  return (
    <div className="space-y-6">
      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-4">
        {metricCard("預期年化報酬", current.expectedReturn, optimal.expectedReturn)}
        {metricCard("年化波動率", current.volatility, optimal.volatility)}
        {metricCard(`夏普比率（RFR=${riskFreeRate.toFixed(1)}%）`, current.sharpe, optimal.sharpe, "", 3)}
      </div>

      {/* Efficient frontier + allocation panel */}
      <div className={expanded ? "space-y-4" : "grid grid-cols-5 gap-4"}>
        {/* Frontier chart/table card */}
        <div className={`rounded-lg border p-4 flex flex-col ${expanded ? "" : "col-span-3"}`}>
          {/* Header row */}
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm">有效前緣</h3>
            <div className="flex items-center gap-1">
              {/* Chart / Table toggle */}
              <button
                onClick={() => setFrontierView("chart")}
                className={`p-1 rounded transition-colors ${frontierView === "chart" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                title="圖表檢視"
              >
                <BarChart2 size={14} />
              </button>
              <button
                onClick={() => setFrontierView("table")}
                className={`p-1 rounded transition-colors ${frontierView === "table" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                title="清單檢視（所有點位）"
              >
                <List size={14} />
              </button>
              <div className="w-px h-3 bg-border mx-0.5" />
              {/* Expand toggle (chart view only) */}
              <button
                onClick={() => setExpanded(v => !v)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                title={expanded ? "縮小" : "放大"}
              >
                {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>

          {frontierView === "chart" ? (
            <>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 25, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="risk" name="波動率" unit="%" type="number" domain={["auto", "auto"]}
                    label={{ value: "波動率 (%)", position: "insideBottom", offset: -12, fontSize: 11 }} />
                  <YAxis dataKey="return" name="預期報酬" unit="%" type="number" domain={["auto", "auto"]}
                    label={{ value: "預期報酬 (%)", angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload as FrontierPoint;
                      return (
                        <div className="bg-background border rounded shadow p-2 text-xs space-y-0.5">
                          <p>報酬：<span className="font-mono">{d.return}%</span></p>
                          <p>波動：<span className="font-mono">{d.risk}%</span></p>
                          <p>夏普：<span className="font-mono">{d.sharpe}</span></p>
                          <p className="text-muted-foreground mt-1">點擊查看配置</p>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    name="有效前緣"
                    data={efficientFrontier}
                    shape={FrontierDot}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(data: any) => toggleSelected(data as FrontierPoint)}
                  />
                  <ReferenceDot
                    x={parseFloat(current.volatility.toFixed(2))}
                    y={parseFloat(current.expectedReturn.toFixed(2))}
                    r={7} fill="#3B82F6" stroke="#fff" strokeWidth={2}
                    label={{ value: "目前", position: "top", fontSize: 11, fill: "#3B82F6" }}
                  />
                  <ReferenceDot
                    x={parseFloat(optimal.volatility.toFixed(2))}
                    y={parseFloat(optimal.expectedReturn.toFixed(2))}
                    r={7} fill="#E87930" stroke="#fff" strokeWidth={2}
                    label={{ value: "最佳", position: "top", fontSize: 11, fill: "#E87930" }}
                  />
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-1 text-xs justify-center">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />目前</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full inline-block" style={{ background: "#E87930" }} />最佳（最大夏普）</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-indigo-500 inline-block" />已選點位</span>
              </div>
              {/* Frontier table — always visible below chart for precise selection */}
              <div className="mt-3 border-t pt-2">
                <p className="text-[10px] text-muted-foreground mb-1">全部點位（點選選取）</p>
                <div className="max-h-36 overflow-y-auto">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-background border-b">
                      <tr className="text-muted-foreground text-[10px]">
                        <th className="text-left font-normal pb-0.5 pr-2">波動率</th>
                        <th className="text-left font-normal pb-0.5 pr-2">報酬</th>
                        <th className="text-left font-normal pb-0.5 pr-2">夏普</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {efficientFrontier.map((p, idx) => {
                        const isSel = selected?.risk === p.risk && selected?.return === p.return;
                        const isOpt = idx === optimalFrontierIdx;
                        return (
                          <tr
                            key={idx}
                            onClick={() => toggleSelected(p)}
                            className={`cursor-pointer transition-colors ${
                              isSel
                                ? "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300"
                                : "hover:bg-muted/50"
                            }`}
                          >
                            <td className="py-0.5 pr-2">{p.risk}%</td>
                            <td className="py-0.5 pr-2">{p.return}%</td>
                            <td className="py-0.5 pr-2">{p.sharpe}</td>
                            <td className="py-0.5 text-right">
                              {isOpt && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 font-sans">
                                  最佳
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            /* Table-only view — full scrollable list, taller */
            <div className="flex-1 overflow-y-auto" style={{ maxHeight: expanded ? 600 : 420 }}>
              <table className="w-full text-sm font-mono">
                <thead className="sticky top-0 bg-background border-b">
                  <tr className="text-muted-foreground text-xs">
                    <th className="text-left font-normal py-1.5 pr-3">#</th>
                    <th className="text-left font-normal py-1.5 pr-3">波動率</th>
                    <th className="text-left font-normal py-1.5 pr-3">預期報酬</th>
                    <th className="text-left font-normal py-1.5 pr-3">夏普比率</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {efficientFrontier.map((p, idx) => {
                    const isSel = selected?.risk === p.risk && selected?.return === p.return;
                    const isOpt = idx === optimalFrontierIdx;
                    return (
                      <tr
                        key={idx}
                        onClick={() => toggleSelected(p)}
                        className={`cursor-pointer border-b last:border-0 transition-colors ${
                          isSel
                            ? "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300"
                            : isOpt
                            ? "bg-orange-50 dark:bg-orange-950/20"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <td className="py-1.5 pr-3 text-muted-foreground text-xs">{idx + 1}</td>
                        <td className="py-1.5 pr-3">{p.risk}%</td>
                        <td className="py-1.5 pr-3">{p.return}%</td>
                        <td className="py-1.5 pr-3">{p.sharpe}</td>
                        <td className="py-1.5 text-right">
                          {isOpt && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 font-sans">
                              最佳
                            </span>
                          )}
                          {isSel && !isOpt && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-sans">
                              已選
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Allocation panel */}
        <div className={`rounded-lg border p-4 flex flex-col ${expanded ? "" : "col-span-2"}`}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold text-sm">配置比例</h3>
              <p className={`text-xs mt-0.5 ${selected ? "text-indigo-600" : "text-emerald-600"}`}>
                {displayLabel}
              </p>
            </div>
            {selected && (
              <button
                onClick={() => setSelected(null)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0 ml-2 mt-0.5"
              >
                <RotateCcw size={11} /> 重置
              </button>
            )}
          </div>

          <div className="space-y-1.5 flex-1">
            {rows
              .filter(r => r.displayW > 0.05)
              .sort((a, b) => b.displayW - a.displayW)
              .map(r => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: BUCKET_COLOR[r.bucket] }} />
                  <span className="font-mono text-xs w-14 shrink-0 truncate">{r.id}</span>
                  <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-200"
                      style={{ width: `${Math.min(r.displayW / 50 * 100, 100)}%`, backgroundColor: BUCKET_COLOR[r.bucket] }}
                    />
                  </div>
                  <span className="font-mono text-xs w-10 text-right shrink-0">{r.displayW.toFixed(1)}%</span>
                </div>
              ))}
          </div>

          <div className="border-t mt-3 pt-2 flex justify-between text-xs text-muted-foreground font-mono">
            <span>合計</span>
            <span>{rows.reduce((s, r) => s + r.displayW, 0).toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Weight comparison bar chart */}
      <div className="rounded-lg border p-4">
        <h3 className="font-semibold text-sm mb-3">比例對比（目前 vs 最佳）</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} layout="vertical" margin={{ left: 20, right: 40 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" unit="%" domain={[0, 35]} fontSize={11} />
            <YAxis type="category" dataKey="id" width={60} fontSize={11} />
            <Tooltip
              formatter={(val) => [`${Number(val).toFixed(1)}%`]}
              labelFormatter={l => rows.find(r => r.id === l)?.name ?? String(l)}
            />
            <Bar dataKey="currentW" name="目前" fill="#94a3b8" radius={[0, 3, 3, 0]}>
              {rows.map(r => <Cell key={r.id} fill="#94a3b8" />)}
            </Bar>
            <Bar dataKey="optimalW" name="最佳" radius={[0, 3, 3, 0]}>
              {rows.map(r => <Cell key={r.id} fill={BUCKET_COLOR[r.bucket]} />)}
              <LabelList dataKey="optimalW" position="right" formatter={(v: unknown) => `${Number(v).toFixed(1)}%`} style={{ fontSize: 10 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Adjustment suggestions */}
      <div className="rounded-lg border p-4">
        <h3 className="font-semibold text-sm mb-3">建議調整清單（以最佳配置為目標）</h3>
        <div className="space-y-2">
          {rows
            .filter(r => Math.abs(r.diff) >= 0.5)
            .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
            .map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BUCKET_COLOR[r.bucket] }} />
                  <span className="font-mono font-medium w-20">{r.name}</span>
                  <span className="text-muted-foreground text-xs">{BUCKET_LABEL[r.bucket]}桶</span>
                </div>
                <div className="flex items-center gap-3 font-mono">
                  <span className="text-muted-foreground">{r.currentW.toFixed(1)}%</span>
                  <span className="text-muted-foreground">→</span>
                  <span style={{ color: BUCKET_COLOR[r.bucket] }}>{r.optimalW.toFixed(1)}%</span>
                  <span className={`w-16 text-right font-semibold ${r.diff > 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {r.diff > 0 ? "+" : ""}{r.diff.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          {rows.every(r => Math.abs(r.diff) < 0.5) && (
            <p className="text-sm text-emerald-600">目前配置已接近最佳！無需大幅調整。</p>
          )}
        </div>
      </div>
    </div>
  );
}
