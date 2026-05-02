import { NextRequest, NextResponse } from "next/server";

type PricePoint = { date: string; price: number };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HISTORY_YEARS = 25;
// Use 10 years for correlation — balances structural recency (post-2015 TSMC
// integration) with enough data points for a stable Pearson estimate.
const CORR_LOOKBACK_MONTHS = 120;
// Trigger automatic proxy discovery for custom tickers with fewer than 15 years
// of own price history, giving the optimizer a more complete return series.
const PROXY_DISCOVERY_MIN_MONTHS = 180;

// Proxy tickers extend an ETF's history back through an older equivalent instrument
// whose adj-close data (dividend-adjusted) is available on Yahoo Finance.
// Returns are spliced at the ETF's inception: proxy returns used before, ETF returns after.
// Prices are NEVER merged across series — only the return series are concatenated —
// so no spurious "inception return" arises from differing price levels.
const PROXY_TICKERS: Record<string, string> = {
  // --- S&P 500 / US broad ---
  VOO:  "SPY",     // SPY adj close since 1993-01; VOO since 2010-09 → +17 years (dot-com + GFC)
  IVV:  "SPY",     // IVV since 2000-05
  SPLG: "SPY",     // SPLG since 2005-11
  VTI:  "SPY",     // US Total Market; large-cap dominates; SPY reasonable proxy
  ITOT: "SPY",
  SCHB: "SPY",
  // --- Nasdaq ---
  QQQM: "QQQ",     // QQQM since 2020-10; QQQ since 1999-03 → +21 years
  // --- International developed ---
  VEA:  "EFA",     // EFA adj close since 2001-08; VEA since 2007-07 → +6 years
  IEFA: "EFA",     // IEFA since 2012-10
  SPDW: "EFA",
  SCHF: "EFA",
  // --- Emerging markets ---
  VWO:  "EEM",     // EEM adj close since 2003-04; VWO since 2005-03 → +2 years
  IEMG: "EEM",     // IEMG since 2012-10
  SPEM: "EEM",
  SCHE: "EEM",
  // --- Taiwan-listed ---
  "006208.TW": "0050.TW",  // Same TAIEX 50 index; 006208 since 2012-06
  "0056.TW":   "0050.TW",  // High-dividend; same market exposure
  "00850.TW":  "0050.TW",
  "00881.TW":  "0050.TW",
  // --- Crypto ---
  IBIT: "BTC-USD", // BTC-USD since 2014-09; IBIT since 2024-01 → +9 years
  FBTC: "BTC-USD",
  BITB: "BTC-USD",
  GBTC: "BTC-USD", // GBTC since 2015-05 (earlier than other spot ETFs)
  // --- Gold ---
  IAU:  "GLD",     // GLD since 2004-11; IAU since 2005-01 → +2 months
  GLDM: "GLD",     // GLDM since 2018-06
  SGOL: "GLD",
  // --- Ultra-short / cash-like ---
  SGOV: "SHY",     // SHY adj close since 2002-07; SGOV since 2022-10 → +20 years (multi-rate cycles)
  BIL:  "SHY",     // BIL since 2007-05
  TBIL: "SHY",
  // --- US aggregate / intermediate bonds ---
  BND:  "AGG",     // AGG since 2003-09; BND since 2007-04 → +4 years
  // --- Small cap ---
  SCHA: "IWM",     // IWM (Russell 2000) since 2000-05; SCHA since 2009-11 → +9 years
  VTWO: "IWM",
  IJR:  "IWM",
  // --- REITs ---
  VNQ:  "IYR",     // IYR since 2000-06; VNQ since 2004-09 → +4 years
  SCHH: "IYR",
  USRT: "IYR",
  // --- Dividend ---
  SCHD: "DVY",     // DVY since 2003-11; SCHD since 2011-10 → +8 years
  VYM:  "DVY",     // VYM since 2006-11
  DGRO: "DVY",
};

// Maps Yahoo Finance fundProfile.categoryName → proxy ticker for auto-discovery.
// Used when a user-added ticker has < PROXY_DISCOVERY_MIN_MONTHS of own history
// and is not already in PROXY_TICKERS.
const CATEGORY_PROXY: Record<string, string> = {
  "Large Blend":               "SPY",
  "Large Growth":              "QQQ",
  "Large Value":               "SPY",
  "Mid-Cap Blend":             "MDY",
  "Mid-Cap Growth":            "MDY",
  "Mid-Cap Value":             "MDY",
  "Small Blend":               "IWM",
  "Small Growth":              "IWM",
  "Small Value":               "IWM",
  "Foreign Large Blend":       "EFA",
  "Foreign Large Growth":      "EFA",
  "Foreign Large Value":       "EFA",
  "Foreign Small/Mid Blend":   "EFA",
  "Diversified Emerging Mkts": "EEM",
  "China Region":              "EEM",
  "Short Government":          "SHY",
  "Ultrashort Bond":           "SHY",
  "Intermediate Government":   "IEF",
  "Long Government":           "TLT",
  "Short-Term Bond":           "AGG",
  "Intermediate Core Bond":    "AGG",
  "Intermediate Core-Plus Bond": "AGG",
  "Long-Term Bond":            "TLT",
  "High Yield Bond":           "HYG",
  "Corporate Bond":            "AGG",
  "Inflation-Protected Bond":  "TIP",
  "Real Estate":               "IYR",
  "Commodities Precious Metals": "GLD",
  "Commodities Broad Basket":  "DJP",
  "Digital Assets":            "BTC-USD",
  "Technology":                "QQQ",
  "Health":                    "XLV",
  "Financial":                 "XLF",
  "Energy":                    "XLE",
  "Consumer Defensive":        "SPY",
  "Consumer Cyclical":         "SPY",
  "Utilities":                 "SPY",
};

let crumbCache: { crumb: string; cookie: string; ts: number } | null = null;

async function getYFCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  if (crumbCache && Date.now() - crumbCache.ts < 50 * 60 * 1000) return crumbCache;
  try {
    const initRes = await fetch("https://finance.yahoo.com/quote/SPY", {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    const rawCookie = initRes.headers.get("set-cookie") ?? "";
    const cookie = rawCookie
      .split(/,(?=[^;]+=[^;]+)/)
      .map(c => c.trim().split(";")[0])
      .filter(Boolean)
      .join("; ");
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, Cookie: cookie, Accept: "*/*" },
    });
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.startsWith("<") || crumb.length > 20) return null;
    crumbCache = { crumb, cookie, ts: Date.now() };
    return crumbCache;
  } catch { return null; }
}

async function fetchYFChart(symbol: string): Promise<{ points: PricePoint[]; currency: string | null } | null> {
  const now = Math.floor(Date.now() / 1000);
  const p1 = now - HISTORY_YEARS * 365 * 24 * 3600;
  const auth = await getYFCrumb();

  for (const base of ["query2", "query1"]) {
    const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
    const url = `https://${base}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&period1=${p1}&period2=${now}${crumbParam}`;
    try {
      const headers: Record<string, string> = {
        "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-US,en;q=0.9",
      };
      if (auth) headers["Cookie"] = auth.cookie;
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result?.timestamp) continue;
      const meta = result.meta as { currency?: string } | undefined;
      const currency = meta?.currency ?? null;
      // Yahoo Finance monthly timestamps for TWD-denominated securities appear as the
      // previous UTC day because Taiwan close (13:30 CST = 05:30 UTC) falls before
      // the UTC-midnight boundary that separates months. Adding the UTC+8 offset
      // recovers the correct local-calendar month.
      const tzMs = currency === "TWD" ? 8 * 3600 * 1000 : 0;
      const ts: number[] = result.timestamp;
      const adj: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];
      const cl: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
      const raw = adj.filter(Boolean).length > 0 ? adj : cl;
      // Exclude the current (incomplete) month — Yahoo returns a partial bar for the
      // ongoing month whose close is today's price, not a full month's close.
      const currentYearMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
      const pts = ts
        .map((t, i) => ({ date: new Date(t * 1000 + tzMs).toISOString().slice(0, 7), price: raw[i] ?? 0 }))
        .filter(d => d.price > 0 && isFinite(d.price) && d.date < currentYearMonth);
      if (pts.length >= 6) return { points: pts, currency };
    } catch { continue; }
  }
  return null;
}

async function fetchMonthlyPrices(ticker: string): Promise<{ points: PricePoint[]; resolvedSymbol: string; currency: string | null } | null> {
  let r = await fetchYFChart(ticker);
  if (r) return { points: r.points, resolvedSymbol: ticker, currency: r.currency };
  if (!ticker.includes(".")) {
    r = await fetchYFChart(`${ticker}.TW`);
    if (r) return { points: r.points, resolvedSymbol: `${ticker}.TW`, currency: r.currency };
  }
  return null;
}

// Fetch ETF category from Yahoo Finance quoteSummary (fundProfile module).
// Returns the categoryName string (e.g. "Large Blend") or null if unavailable.
async function fetchYFCategory(symbol: string): Promise<string | null> {
  const auth = await getYFCrumb();
  const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=fundProfile${crumbParam}`;
  try {
    const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/json" };
    if (auth) headers["Cookie"] = auth.cookie;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.quoteSummary?.result?.[0]?.fundProfile?.categoryName ?? null;
  } catch { return null; }
}

// ---------- statistics ----------

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function pearsonCorr(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  const num = a.reduce((s, ai, i) => s + (ai - ma) * (b[i] - mb), 0);
  const den = Math.sqrt(
    a.reduce((s, ai) => s + (ai - ma) ** 2, 0) *
    b.reduce((s, bi) => s + (bi - mb) ** 2, 0)
  );
  return den === 0 ? 0 : Math.max(-1, Math.min(1, num / den));
}

// Build a monthly-return Map from a price series.
// Outlier filter: skip months where |return| > 90%.
function buildReturnMap(prices: PricePoint[], dateCap?: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i < prices.length; i++) {
    if (dateCap && prices[i].date >= dateCap) continue;
    const r = prices[i].price / prices[i - 1].price - 1;
    if (Math.abs(r) <= 0.9) map.set(prices[i].date, r);
  }
  return map;
}

// ---------- handler ----------

const NON_FETCHABLE = new Set(["Cash", "cash", "現金", "台幣現金", "USDCash", "美金現金"]);

export type CorrMeta = Record<string, Record<string, { months: number; simulated: boolean }>>;

export async function POST(req: NextRequest) {
  const { tickers } = (await req.json()) as { tickers: string[] };
  const fetchable = tickers.filter(t => !NON_FETCHABLE.has(t));

  // --- 1. Fetch all primary price series in parallel ---
  const priceData: Record<string, PricePoint[]> = {};
  const resolvedSymbols: Record<string, string> = {};
  const fetchErrors: Record<string, string> = {};

  await Promise.all(fetchable.map(async ticker => {
    const result = await fetchMonthlyPrices(ticker);
    if (result) {
      priceData[ticker] = result.points;
      resolvedSymbols[ticker] = result.resolvedSymbol;
    } else {
      fetchErrors[ticker] = `找不到 ${ticker} 的資料（也嘗試了 ${ticker}.TW）`;
    }
  }));

  const successTickers = Object.keys(priceData);

  // --- 2. Determine effective proxy for each ticker ---
  // Static map takes priority. For tickers not in the static map that have fewer
  // than PROXY_DISCOVERY_MIN_MONTHS of own price data, query Yahoo's fundProfile
  // to discover the ETF category and map it to a suitable historical proxy.
  const needsDiscovery = successTickers.filter(t =>
    !PROXY_TICKERS[t] && (priceData[t].length - 1) < PROXY_DISCOVERY_MIN_MONTHS
  );

  const discoveredProxies: Record<string, string> = {};
  if (needsDiscovery.length > 0) {
    await Promise.all(needsDiscovery.map(async ticker => {
      const sym = resolvedSymbols[ticker] ?? ticker;
      const category = await fetchYFCategory(sym);
      if (category && CATEGORY_PROXY[category]) {
        discoveredProxies[ticker] = CATEGORY_PROXY[category];
      }
    }));
  }

  // Merge static + dynamic proxy maps; static takes priority
  const effectiveProxies: Record<string, string> = { ...discoveredProxies, ...PROXY_TICKERS };

  // --- 3. Fetch proxy prices (deduplicated) in parallel ---
  const proxySymbolsNeeded = new Set(
    successTickers
      .filter(t => effectiveProxies[t])
      .map(t => effectiveProxies[t])
  );

  const proxyPriceCache: Record<string, PricePoint[]> = {};
  await Promise.all(
    Array.from(proxySymbolsNeeded).map(async proxySym => {
      const result = await fetchMonthlyPrices(proxySym);
      if (result) proxyPriceCache[proxySym] = result.points;
    })
  );

  // --- 4. Build monthly return maps with proxy extension ---
  // Strategy: compute returns independently from each price series, then merge.
  // Proxy returns are used ONLY for months strictly before the ETF's first price date,
  // so the "inception month" transition never produces a cross-series price ratio.
  const returnMaps: Record<string, Map<string, number>> = {};
  const proxyMonthCounts: Record<string, number> = {};

  for (const ticker of successTickers) {
    const etfPrices = priceData[ticker];
    const etfStartDate = etfPrices[0]?.date ?? "9999-99";

    const combined = new Map<string, number>();
    const proxySym = effectiveProxies[ticker];
    const proxyPrices = proxySym ? proxyPriceCache[proxySym] : undefined;

    if (proxyPrices) {
      const proxyMap = buildReturnMap(proxyPrices, etfStartDate);
      proxyMap.forEach((v, k) => combined.set(k, v));
      proxyMonthCounts[ticker] = proxyMap.size;
    }

    // ETF returns always take priority over proxy for any overlapping months
    const etfMap = buildReturnMap(etfPrices);
    etfMap.forEach((v, k) => combined.set(k, v));

    returnMaps[ticker] = combined;
  }

  // --- 5. Per-ticker return & volatility ---
  const results = tickers.map(ticker => {
    if (NON_FETCHABLE.has(ticker)) return { ticker, skipped: true };
    if (fetchErrors[ticker]) return { ticker, error: fetchErrors[ticker] };
    const allReturns = Array.from(returnMaps[ticker].values());
    const etfMonths = returnMaps[ticker].size - (proxyMonthCounts[ticker] ?? 0);
    const proxyMonths = proxyMonthCounts[ticker] ?? 0;
    const proxySym = proxyMonths > 0 ? effectiveProxies[ticker] : undefined;
    return {
      ticker,
      resolvedSymbol: resolvedSymbols[ticker],
      proxyTicker: proxySym,
      proxyMonths: proxyMonths > 0 ? proxyMonths : undefined,
      proxyAutoDiscovered: proxySym ? !!discoveredProxies[ticker] && !PROXY_TICKERS[ticker] : undefined,
      annualizedReturn: parseFloat((mean(allReturns) * 12 * 100).toFixed(2)),
      annualizedVolatility: parseFloat((std(allReturns) * Math.sqrt(12) * 100).toFixed(2)),
      ownMonths: etfMonths,
      totalMonths: allReturns.length,
    };
  });

  // --- 6. Per-pair correlation ---
  // The extended return maps (including proxy data) are used here, so pairs like
  // IBIT (via BTC-USD back to 2014) get a proper 10-year correlation window.
  const correlations: Record<string, Record<string, number>> = {};
  const correlationMeta: CorrMeta = {};

  for (const ti of successTickers) {
    correlations[ti] = {};
    correlationMeta[ti] = {};

    for (const tj of successTickers) {
      if (ti === tj) {
        correlations[ti][tj] = 1;
        correlationMeta[ti][tj] = { months: returnMaps[ti].size, simulated: false };
        continue;
      }

      const ri_map = returnMaps[ti];
      const rj_map = returnMaps[tj];
      const mi = new Set(ri_map.keys());
      const mj = new Set(rj_map.keys());
      const allPairMonths = Array.from(mi).filter(m => mj.has(m)).sort();
      // Slice to most recent CORR_LOOKBACK_MONTHS
      const pairMonths = allPairMonths.slice(-CORR_LOOKBACK_MONTHS);

      if (pairMonths.length >= 3) {
        const ri = pairMonths.map(m => ri_map.get(m)!);
        const rj = pairMonths.map(m => rj_map.get(m)!);
        correlations[ti][tj] = parseFloat(pearsonCorr(ri, rj).toFixed(3));
      } else {
        correlations[ti][tj] = 0;
      }
      correlationMeta[ti][tj] = {
        months: pairMonths.length,
        simulated: pairMonths.length < CORR_LOOKBACK_MONTHS,
      };
    }
  }

  return NextResponse.json({ results, correlations, correlationMeta });
}
