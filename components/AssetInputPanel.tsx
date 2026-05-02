"use client";
import { useState } from "react";
import { Asset, BucketType, BUCKET_CONSTRAINTS, LEVERAGE_VOL_MULTIPLIER } from "@/lib/assets";
import { CorrMatrix } from "@/lib/optimizer";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import CorrelationMatrixPanel, { CorrMeta } from "@/components/CorrelationMatrixPanel";
import { RotateCcw, RefreshCw, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Info, Plus, Trash2, AlertTriangle } from "lucide-react";

export type TickerFetchStatus = Record<string, "loading" | "success" | "error" | "skipped" | null>;
export type TickerFetchMeta  = Record<string, { totalMonths?: number; commonMonths?: number; resolvedSymbol?: string; proxyTicker?: string; proxyMonths?: number; proxyAutoDiscovered?: boolean }>;

interface Props {
  assets: Asset[];
  currentWeights: Record<string, number>;
  perAssetMin: Record<string, number>;
  tickerStatus: TickerFetchStatus;
  tickerMeta: TickerFetchMeta;
  isFetching: boolean;
  fetchPeriod: string | null;
  corrMatrix: CorrMatrix;
  corrMeta: CorrMeta;
  onChange: (assets: Asset[]) => void;
  onWeightChange: (id: string, val: number) => void;
  onMinWeightChange: (id: string, val: number) => void;
  onTickerChange: (oldId: string, newId: string) => void;
  onFetch: () => void;
  onAddAsset: (bucket: BucketType, tempId: string) => void;
  onRemoveAsset: (id: string) => void;
  onCorrMatrixChange: (m: CorrMatrix) => void;
  onCorrMetaReset: () => void;
}

function StatusIcon({ status, meta }: { status: TickerFetchStatus[string]; meta?: TickerFetchMeta[string] }) {
  if (!status) return null;
  if (status === "loading") return <Loader2 size={13} className="animate-spin text-muted-foreground" />;
  if (status === "error")   return <XCircle size={13} className="text-red-500" />;
  if (status === "success") {
    const totalMonths = meta?.totalMonths;
    const proxyMonths = meta?.proxyMonths;
    const proxyTicker = meta?.proxyTicker;
    const proxyAutoDiscovered = meta?.proxyAutoDiscovered;
    const isPartial = totalMonths !== undefined && totalMonths < 180;
    const ownMonths = proxyMonths && totalMonths ? totalMonths - proxyMonths : totalMonths;
    let tooltip = totalMonths ? `歷史資料共 ${totalMonths} 個月` : "";
    if (isPartial) tooltip = `歷史資料僅 ${totalMonths} 個月（未滿 15 年），報酬與波動估計樣本較少`;
    if (proxyTicker && proxyMonths) {
      const proxyKind = proxyAutoDiscovered ? "自動偵測代理" : "代理延伸";
      tooltip += `\nETF 本身 ${ownMonths}M + ${proxyTicker} ${proxyKind} ${proxyMonths}M`;
    }
    return (
      <span className="flex items-center gap-0.5" title={tooltip}>
        <CheckCircle2 size={13} className={isPartial ? "text-orange-500" : "text-emerald-500"} />
        {totalMonths && (
          <span className={`text-[10px] font-mono ${isPartial ? "text-orange-600" : "text-emerald-600"}`}>
            {totalMonths}M{proxyTicker && proxyMonths ? "*" : ""}
          </span>
        )}
      </span>
    );
  }
  return null;
}

function MethodologyBox() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border bg-muted/20 text-sm">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 transition-colors rounded-lg"
        onClick={() => setOpen(v => !v)}
      >
        <span className="flex items-center gap-2 font-medium text-sm">
          <Info size={14} className="text-primary" />
          資料抓取說明 — 來源、期間與計算方式
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 text-sm border-t mt-0 pt-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">資料來源</p>
              <p>Yahoo Finance</p>
              <p className="text-xs text-muted-foreground">月頻調整後收盤價（Adj Close）</p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">抓取期間</p>
              <p>年化報酬／波動：最長 <span className="font-mono font-semibold">25 年</span></p>
              <p>相關係數：最近 <span className="font-mono font-semibold">10 年</span></p>
              <p className="text-xs text-muted-foreground">
                若標的上市未滿該期限，以實際上市日起算，並以虛線框標示。
              </p>
            </div>
          </div>

          <hr className="border-border" />

          <div className="space-y-3">
            <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">計算方式</p>

            <div className="rounded-md bg-background border p-3 space-y-1">
              <p className="font-medium">月報酬率</p>
              <p className="font-mono text-xs bg-muted px-2 py-1 rounded">rₜ = Pₜ / Pₜ₋₁ − 1</p>
              <p className="text-xs text-muted-foreground">
                簡單報酬率（非對數報酬）。Pₜ 為當月調整後收盤價，已還原股息與分割（除權除息還原）。
              </p>
            </div>

            <div className="rounded-md bg-background border p-3 space-y-1">
              <p className="font-medium">年化報酬</p>
              <p className="font-mono text-xs bg-muted px-2 py-1 rounded">年化報酬 = mean(rₜ) × 12</p>
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">算術年化</strong>（月均報酬 × 12），Markowitz 均值–變異數模型的輸入要求。
              </p>
              <div className="rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 px-2 py-1.5 mt-1 space-y-1">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">⚠ 算術報酬 ≠ 一般公告的 CAGR（複合年化成長率）</p>
                <p className="font-mono text-xs text-amber-700 dark:text-amber-400 bg-amber-100/60 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">算術報酬 ≈ CAGR + σ² / 2</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  算術報酬永遠高於 CAGR，差值約等於年化波動率的平方除以 2（稱為「波動損耗」）。
                  例：0050 官方 CAGR ≈ 12.8%、波動率 19% → 算術報酬 ≈ 12.8% + 19²/200 ≈ 14.6%。
                  這是正常現象，非資料錯誤。
                </p>
              </div>
            </div>

            <div className="rounded-md bg-background border p-3 space-y-1">
              <p className="font-medium">年化波動率（標準差）</p>
              <p className="font-mono text-xs bg-muted px-2 py-1 rounded">年化波動率 = std(rₜ) × √12</p>
              <p className="text-xs text-muted-foreground">
                月報酬率的樣本標準差乘以 √12，假設月報酬率獨立同分布（IID）。
              </p>
            </div>

            <div className="rounded-md bg-background border p-3 space-y-1">
              <p className="font-medium">相關係數（Correlation）</p>
              <p className="font-mono text-xs bg-muted px-2 py-1 rounded">ρᵢⱼ = Pearson correlation（rᵢ, rⱼ）最近 10 年</p>
              <p className="text-xs text-muted-foreground">
                取各標的近 10 年共同月份的月報酬序列，計算兩兩之間的 Pearson 線性相關係數。
                未滿 10 年資料的標的組合以虛線框標示，建議手動確認。
              </p>
            </div>
          </div>

          <hr className="border-border" />

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground text-xs uppercase tracking-wide">注意事項</p>
            <p>⚠ 過去統計數字不代表未來表現，所有估計值均含誤差。</p>
            <p>⚠ 槓桿型 ETF（如 00631L）的波動率遠高於一般 ETF，歷史數字包含槓桿損耗，長期實際報酬可能顯著低於短期估計。</p>
            <p>⚠ 較新的 ETF（如 IBIT，2024 年上市）歷史月數有限，估計不穩定，建議手動調整。</p>
            <p>⚠ 相關係數在牛熊轉換期間可能急劇改變，使用靜態歷史相關係數會低估尾部風險。</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AssetInputPanel({
  assets, currentWeights, perAssetMin, tickerStatus, tickerMeta, isFetching, fetchPeriod,
  corrMatrix, corrMeta,
  onChange, onWeightChange, onMinWeightChange, onTickerChange, onFetch,
  onAddAsset, onRemoveAsset, onCorrMatrixChange, onCorrMetaReset,
}: Props) {
  const [editingTicker, setEditingTicker] = useState<{ id: string; value: string } | null>(null);

  function updateAsset(id: string, field: "expectedReturn" | "volatility", val: number) {
    onChange(assets.map(a => a.id === id ? { ...a, [field]: val } : a));
  }

  function resetAsset(id: string) {
    onChange(assets.map(a => a.id === id ? { ...a, expectedReturn: a.defaultReturn, volatility: a.defaultVolatility } : a));
  }

  function commitTickerEdit(oldId: string) {
    if (!editingTicker || editingTicker.id !== oldId) return;
    const newId = editingTicker.value.trim().toUpperCase();
    if (newId && newId !== oldId) onTickerChange(oldId, newId);
    setEditingTicker(null);
  }

  function handleAddAssetClick(bucket: BucketType) {
    const tempId = `TICKER_${Date.now()}`;
    onAddAsset(bucket, tempId);
    setTimeout(() => setEditingTicker({ id: tempId, value: "" }), 30);
  }

  const totalWeight = Object.values(currentWeights).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">設定各資產的標的、預期報酬與波動率，以及目前持倉比例。</p>
          {fetchPeriod && (
            <p className="text-xs text-emerald-600 mt-0.5">✓ 已抓取歷史資料：{fetchPeriod}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-mono font-semibold ${Math.abs(totalWeight - 100) > 0.5 ? "text-red-500" : "text-emerald-600"}`}>
            總計 {totalWeight.toFixed(1)}%
          </span>
          <Button variant="outline" size="sm" onClick={onFetch} disabled={isFetching} className="gap-1.5">
            {isFetching
              ? <><Loader2 size={14} className="animate-spin" /> 抓取中...</>
              : <><RefreshCw size={14} /> 抓取歷史資料</>}
          </Button>
        </div>
      </div>

      <MethodologyBox />

      {/* Leveraged ETF warning — shown whenever any leveraged asset is present */}
      {assets.some(a => a.leveraged) && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-700 p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400 font-semibold text-sm">
            <AlertTriangle size={14} />
            槓桿 ETF 風險提示（{assets.filter(a => a.leveraged).map(a => a.id).join("、")}）
          </div>
          <ul className="text-xs text-orange-700 dark:text-orange-400 space-y-1 list-disc list-inside">
            <li>
              月頻收盤資料的 std × √12 <strong>低估</strong>日再平衡槓桿 ETF 的真實風險——月內漲跌折損（Volatility Drag）不會反映在月末報酬標準差，但卻是真實的虧損來源。
              系統已自動對標記為「槓桿」的標的波動率乘以 <strong>{LEVERAGE_VOL_MULTIPLIER}x</strong> 修正係數。
            </li>
            <li>
              MPT 使用<strong>算術年化報酬</strong>（月均 × 12），對槓桿 ETF 會<strong>高估長期複利報酬</strong>。
              實際 CAGR ≈ 算術報酬 − σ²/2，波動率 50% 時拖累約 12.5 個百分點。
            </li>
            <li>
              最佳化結果中槓桿 ETF 的配置比例僅供參考，<strong>不代表長期持有的適當比例</strong>。
            </li>
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        標的代號可點擊修改（Enter 確認）。台灣 ETF 輸入代號即可，系統自動嘗試 .TW 後綴。
        抓取後數值自動填入，仍可用 slider 手動覆蓋。
      </p>

      {BUCKET_CONSTRAINTS.map(bc => {
        const bucketAssets = assets.filter(a => a.bucket === bc.bucket);
        return (
          <div key={bc.bucket} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: bc.color }} />
              <span className="font-semibold text-sm">{bc.label}桶</span>
            </div>

            {bucketAssets.map(asset => {
              const w = currentWeights[asset.id] ?? 0;
              const isModified = asset.expectedReturn !== asset.defaultReturn || asset.volatility !== asset.defaultVolatility;
              const status = tickerStatus[asset.id];
              const meta = tickerMeta[asset.id];
              const isEditing = editingTicker?.id === asset.id;
              // Dynamic slider ceiling: expand when fetched value exceeds the 40% hard cap
              const returnSliderMax = Math.max(40, Math.ceil(asset.expectedReturn / 10) * 10 + 10);
              // Warn when fetched return is much higher than default (historical period may be unrepresentative)
              const returnExcess = asset.expectedReturn - asset.defaultReturn;

              return (
                <div key={asset.id} className="flex items-start gap-1.5">
                  <div className="flex-1 grid grid-cols-12 gap-3 items-start text-sm">
                    {/* Ticker */}
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs text-muted-foreground">標的</label>
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <input
                            autoFocus
                            className="w-full border rounded px-1.5 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary uppercase"
                            value={editingTicker.value}
                            onChange={e => setEditingTicker({ id: asset.id, value: e.target.value })}
                            onBlur={() => commitTickerEdit(asset.id)}
                            onKeyDown={e => {
                              if (e.key === "Enter") commitTickerEdit(asset.id);
                              if (e.key === "Escape") setEditingTicker(null);
                            }}
                          />
                        ) : (
                          <button
                            className="w-full text-left border rounded px-1.5 py-1 font-mono font-medium hover:border-primary transition-colors bg-muted/30 truncate"
                            onClick={() => setEditingTicker({ id: asset.id, value: asset.id })}
                            title={meta?.resolvedSymbol ? `Yahoo: ${meta.resolvedSymbol}` : "點擊修改標的代號"}
                          >
                            {asset.id}
                          </button>
                        )}
                        <StatusIcon status={status} meta={meta} />
                      </div>
                      {/* Currency badge + liquid indicator */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onChange(assets.map(a => a.id === asset.id ? { ...a, currency: a.currency === "USD" ? "TWD" : "USD" } : a))}
                          className={`text-[10px] px-1.5 py-0.5 rounded font-bold border transition-colors ${
                            asset.currency === "USD"
                              ? "bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-700"
                              : "bg-green-50 text-green-700 border-green-300 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-400 dark:border-green-700"
                          }`}
                          title="點擊切換幣別"
                        >
                          {asset.currency}
                        </button>
                        {asset.liquid && (
                          <span
                            className="text-[9px] px-1 py-0.5 rounded border bg-muted text-muted-foreground border-border"
                            title="現金/緩衝資產：不納入台幣股票比例約束"
                          >
                            現金
                          </span>
                        )}
                        {asset.leveraged && (
                          <span
                            className="text-[9px] px-1 py-0.5 rounded border bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-700"
                            title={`日槓桿 ETF：抓取的波動率已自動乘以 ${LEVERAGE_VOL_MULTIPLIER}x 修正係數`}
                          >
                            槓桿
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Current weight + per-asset minimum */}
                    <div className="col-span-2 space-y-1">
                      <label className="text-xs text-muted-foreground">目前比例</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min={0} max={100} step={0.5}
                          value={w}
                          onChange={e => onWeightChange(asset.id, parseFloat(e.target.value) || 0)}
                          className="w-full border rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <span className="text-muted-foreground text-xs">%</span>
                      </div>
                      <div className="flex items-center gap-1" title="最佳化時此資產的最低持倉比例">
                        <label className="text-[10px] text-muted-foreground shrink-0">最低</label>
                        <input
                          type="number" min={0} max={50} step={0.5}
                          value={perAssetMin[asset.id] ?? 0}
                          onChange={e => onMinWeightChange(asset.id, parseFloat(e.target.value) || 0)}
                          className={`w-full border rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary ${
                            (perAssetMin[asset.id] ?? 0) > 0 ? "border-primary/50 bg-primary/5" : ""
                          }`}
                        />
                        <span className="text-muted-foreground text-[10px]">%</span>
                      </div>
                    </div>

                    {/* Expected return */}
                    <div className="col-span-4">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">
                          年化報酬 <span className="font-mono text-foreground">{asset.expectedReturn.toFixed(1)}%</span>
                        </label>
                        {isModified && (
                          <button onClick={() => resetAsset(asset.id)} className="text-muted-foreground hover:text-foreground" title="還原預設">
                            <RotateCcw size={11} />
                          </button>
                        )}
                      </div>
                      <Slider
                        min={-10} max={returnSliderMax} step={0.5}
                        value={[asset.expectedReturn]}
                        onValueChange={v => updateAsset(asset.id, "expectedReturn", Array.isArray(v) ? v[0] : v)}
                        className="mt-2"
                      />
                      {returnExcess >= 15 && (
                        <p
                          className="text-[10px] text-orange-600 dark:text-orange-400 mt-1 leading-tight"
                          title="歷史算術報酬受特定時段（如加密貨幣牛市、台股 AI 行情）大幅拉高，不一定反映未來預期。建議手動調整至合理的前瞻值，或還原預設。"
                        >
                          ⚠ 歷史算術報酬高於預設 +{returnExcess.toFixed(0)}pp（預設 {asset.defaultReturn.toFixed(0)}%）
                          — 此數字反映過去特定高報酬期間，請確認是否符合您的未來預期
                        </p>
                      )}
                    </div>

                    {/* Volatility */}
                    <div className="col-span-4">
                      <label className="text-xs text-muted-foreground">
                        年化波動率 <span className="font-mono text-foreground">{asset.volatility.toFixed(1)}%</span>
                      </label>
                      <Slider
                        min={0.1} max={100} step={0.5}
                        value={[asset.volatility]}
                        onValueChange={v => updateAsset(asset.id, "volatility", Array.isArray(v) ? v[0] : v)}
                        className="mt-2"
                      />
                    </div>
                  </div>

                  {/* Remove button */}
                  <button
                    onClick={() => onRemoveAsset(asset.id)}
                    className="mt-6 p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shrink-0"
                    title="移除此標的"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}

            {/* Add asset button */}
            <button
              onClick={() => handleAddAssetClick(bc.bucket)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary border border-dashed rounded px-2 py-1.5 w-full justify-center transition-colors"
            >
              <Plus size={12} /> 新增標的
            </button>
          </div>
        );
      })}

      {/* Correlation matrix */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm">資產間相關係數矩陣</h3>
        <CorrelationMatrixPanel
          assets={assets}
          matrix={corrMatrix}
          corrMeta={corrMeta}
          onChange={onCorrMatrixChange}
          onMetaReset={onCorrMetaReset}
        />
      </div>
    </div>
  );
}
