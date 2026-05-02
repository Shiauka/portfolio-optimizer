"use client";
import { useState } from "react";
import { Asset, CORRELATION_MATRIX } from "@/lib/assets";
import { CorrMatrix } from "@/lib/optimizer";
import { Slider } from "@/components/ui/slider";
import { RotateCcw, AlertTriangle } from "lucide-react";

export type CorrMeta = Record<string, Record<string, { months: number; simulated: boolean }>>;

interface Props {
  assets: Asset[];
  matrix: CorrMatrix;
  corrMeta: CorrMeta;
  onChange: (matrix: CorrMatrix) => void;
  onMetaReset: () => void;
}

function corrColor(v: number): string {
  if (v >= 0) {
    const t = v;
    return `rgb(${Math.round(239 - t * 180)},${Math.round(246 - t * 116)},${Math.round(255 - t * 9)})`;
  } else {
    const t = -v;
    return `rgb(239,${Math.round(246 - t * 178)},${Math.round(255 - t * 187)})`;
  }
}

function corrTextColor(v: number): string {
  return Math.abs(v) > 0.6 ? "#fff" : "#111";
}

export default function CorrelationMatrixPanel({ assets, matrix, corrMeta, onChange, onMetaReset }: Props) {
  const [selected, setSelected] = useState<[string, string] | null>(null);

  function getCorr(a: string, b: string): number {
    return matrix[a]?.[b] ?? (a === b ? 1 : 0);
  }

  function getMeta(a: string, b: string) {
    return corrMeta[a]?.[b] ?? corrMeta[b]?.[a] ?? null;
  }

  function setCorr(a: string, b: string, val: number) {
    const clamped = Math.max(-1, Math.min(0.99, parseFloat(val.toFixed(2))));
    const next: CorrMatrix = JSON.parse(JSON.stringify(matrix));
    if (!next[a]) next[a] = {};
    if (!next[b]) next[b] = {};
    next[a][b] = clamped;
    next[b][a] = clamped;
    onChange(next);
  }

  function resetAll() {
    onChange(JSON.parse(JSON.stringify(CORRELATION_MATRIX)));
    onMetaReset();
    setSelected(null);
  }

  // Collect all simulated pairs (upper triangle only to avoid duplicates)
  const simulatedPairs: Array<{ a: string; b: string; months: number }> = [];
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const meta = getMeta(assets[i].id, assets[j].id);
      if (meta?.simulated) {
        simulatedPairs.push({ a: assets[i].id, b: assets[j].id, months: meta.months });
      }
    }
  }

  const selVal = selected ? getCorr(selected[0], selected[1]) : null;
  const selA   = selected ? assets.find(a => a.id === selected[0]) : null;
  const selB   = selected ? assets.find(a => a.id === selected[1]) : null;
  const selMeta = selected ? getMeta(selected[0], selected[1]) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <p className="text-sm text-muted-foreground">
            點擊任一格來編輯相關係數。對角線固定為 1.00，修改單格自動同步對稱格。
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">資料基礎：</span>
            Yahoo Finance 月頻調整後收盤價 · Pearson 相關係數 ·
            最近 <span className="font-mono font-semibold">10 年</span>（最多 120 期）。
            上市不足 10 年的標的以代理指標回填（如 IBIT → BTC-USD 自 2015 年起），
            確保各對相關係數均有完整 10 年樣本；代理回填期以橙色框標示。
          </p>
        </div>
        <button
          onClick={resetAll}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border rounded px-2 py-1 shrink-0"
        >
          <RotateCcw size={12} /> 還原預設
        </button>
      </div>

      {/* Simulated pairs warning banner */}
      {simulatedPairs.length > 0 && (
        <div className="rounded-lg border border-orange-400 bg-orange-50 dark:bg-orange-950/30 p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400 font-semibold text-xs">
            <AlertTriangle size={13} />
            以下相關係數資料未滿 10 年，數值為實際計算但樣本較少，建議手動確認
          </div>
          <ul className="space-y-0.5 pl-5">
            {simulatedPairs.map(p => (
              <li key={`${p.a}-${p.b}`} className="text-xs text-orange-800 dark:text-orange-300 list-disc">
                <span className="font-mono font-semibold">{p.a}</span> × <span className="font-mono font-semibold">{p.b}</span>
                {" "}的相關係數是用{" "}
                <span className="font-semibold">{p.months} 個月</span>
                {p.months === 0 ? "（不足資料，使用預設值 0）" : " 資料估計，建議手動確認"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Heatmap */}
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="w-16" />
              {assets.map(a => (
                <th key={a.id} className="w-12 h-8 text-center font-mono font-medium text-muted-foreground pb-1">
                  {a.id.length > 6 ? a.id.slice(0, 6) : a.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map(rowA => (
              <tr key={rowA.id}>
                <td className="pr-2 font-mono font-medium text-muted-foreground text-right whitespace-nowrap">
                  {rowA.id}
                </td>
                {assets.map(colB => {
                  const isDiag = rowA.id === colB.id;
                  const val = getCorr(rowA.id, colB.id);
                  const meta = getMeta(rowA.id, colB.id);
                  const isSimulated = !isDiag && meta?.simulated;
                  const isSelected = selected?.[0] === rowA.id && selected?.[1] === colB.id;
                  return (
                    <td
                      key={colB.id}
                      onClick={() => !isDiag && setSelected([rowA.id, colB.id])}
                      title={
                        isDiag ? "自相關 = 1" :
                        meta ? `${meta.months} 個月${meta.simulated ? "（模擬）" : "（實際）"}` :
                        undefined
                      }
                      className={`w-12 h-10 text-center font-mono transition-all ${
                        isDiag ? "cursor-default opacity-60" : "cursor-pointer hover:ring-2 hover:ring-primary hover:ring-inset"
                      } ${isSelected ? "ring-2 ring-primary ring-inset" : ""} ${
                        isSimulated ? "border-2 border-orange-500" : "border"
                      }`}
                      style={{ backgroundColor: corrColor(val), color: corrTextColor(val) }}
                    >
                      {val.toFixed(2)}
                      {isSimulated && <span className="text-[8px] align-super leading-none text-orange-600 font-bold">!</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>−1.00</span>
          <div className="flex h-3 w-32 rounded overflow-hidden">
            {Array.from({ length: 20 }, (_, i) => (
              <div key={i} className="flex-1" style={{ backgroundColor: corrColor(-1 + i / 10) }} />
            ))}
          </div>
          <span>+1.00</span>
        </div>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 h-4 border-2 border-orange-500 rounded-sm" />
          橙色框 = 資料未滿 10 年（&lt; 120 個月）
        </span>
      </div>

      {/* Selected pair editor */}
      {selected && selVal !== null && selA && selB && (
        <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">
                {selA.name} × {selB.name}
                <span className="ml-2 text-muted-foreground font-normal text-xs">相關係數</span>
              </p>
              {selMeta && (
                <p className={`text-xs mt-0.5 ${selMeta.simulated ? "text-amber-600" : "text-emerald-600"}`}>
                  {selMeta.simulated
                    ? `⚠ 模擬估計 — ${selMeta.months} 個月${selMeta.months === 0 ? "（不足資料，使用 0）" : ""}`
                    : `✓ 實際計算 — ${selMeta.months} 個月`}
                </p>
              )}
            </div>
            <span className="font-mono text-lg font-bold">{selVal.toFixed(2)}</span>
          </div>
          <Slider
            min={-100} max={99} step={1}
            value={[Math.round(selVal * 100)]}
            onValueChange={v => setCorr(selected[0], selected[1], (Array.isArray(v) ? v[0] : v) / 100)}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>−1.00（完全負相關）</span>
            <span>0.00（無相關）</span>
            <span>+0.99（高度正相關）</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {selVal > 0.7 && "⚠ 高度正相關：兩資產走勢相近，分散效果有限"}
            {selVal < -0.3 && "✓ 負相關：有對沖效果，可降低組合波動"}
            {selVal >= -0.3 && selVal <= 0.7 && "相關性適中，有一定分散效果"}
          </p>
        </div>
      )}
    </div>
  );
}
