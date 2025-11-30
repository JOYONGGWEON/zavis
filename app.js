// ==========================================
// ZAVIS™ LAB v6.1 - Stable Engine (with Macro Bar)
// ==========================================

// 1. 설정
const PROXY_URL = "https://corsproxy.io/?";
const YAHOO_API_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

// FX 캐시 & 마지막 분석 결과(포지션 계산용)
let fxRateKRW = null;
let lastAnalysis = null;

// 2. 유틸리티 함수
const $ = (id) => document.getElementById(id);

const formatUSD = (num) =>
  "$" +
  Number(num).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function showToast(msg) {
  const el = $("toast-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
}

function showLoading(isLoading) {
  if (isLoading) {
    $("loading-indicator").classList.remove("hidden");
    $("result-card").classList.add("hidden");
  } else {
    $("loading-indicator").classList.add("hidden");
    $("result-card").classList.remove("hidden");
  }
}

// 3. 공통 야후 파서
async function fetchYahooChart(symbol, range = "1d", interval = "1d") {
  const targetUrl = `${YAHOO_API_BASE}${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}`;
  const finalUrl = PROXY_URL + encodeURIComponent(targetUrl);

  const response = await fetch(finalUrl);
  if (!response.ok) throw new Error("Network Error");

  const json = await response.json();
  if (!json.chart || !json.chart.result || !json.chart.result[0]) {
    throw new Error("Invalid Yahoo response");
  }

  const result = json.chart.result[0];
  const meta = result.meta || {};
  const indicators = result.indicators || {};
  const quoteArr = indicators.quote && indicators.quote[0];

  if (!quoteArr) throw new Error("Quote array missing");

  const closes = (quoteArr.close || []).filter((v) => v != null);
  const volumes = (quoteArr.volume || []).filter((v) => v != null);

  if (!closes.length) throw new Error("No closes");

  const lastClose =
    typeof meta.regularMarketPrice === "number"
      ? meta.regularMarketPrice
      : closes[closes.length - 1];

  return { meta, closes, volumes, lastClose };
}

// 3-1. 개별 종목 데이터 (OHLC)
async function fetchStockData(ticker) {
  const symbol = ticker.toUpperCase().trim();
  const targetUrl = `${YAHOO_API_BASE}${symbol}?range=6mo&interval=1d`;
  const finalUrl = PROXY_URL + encodeURIComponent(targetUrl);

  console.log(`[ZAVIS] Fetching: ${symbol}`);

  try {
    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error("Network Error");
    const json = await response.json();

    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("No chart result");

    const meta = result.meta || {};
    const quote = result.indicators?.quote?.[0];
    if (!quote) throw new Error("No quote data");

    const closes = quote.close || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const volumes = quote.volume || [];

    const len = closes.length;
    if (len < 30) throw new Error("Not enough data");

    // null 값 제거
    const cleanCloses = [];
    const cleanHighs = [];
    const cleanLows = [];
    const cleanVolumes = [];

    for (let i = 0; i < len; i++) {
      const c = closes[i];
      const h = highs[i];
      const l = lows[i];
      const v = volumes[i];

      if (c == null || h == null || l == null || v == null) continue;
      cleanCloses.push(c);
      cleanHighs.push(h);
      cleanLows.push(l);
      cleanVolumes.push(v);
    }

    if (cleanCloses.length < 30) throw new Error("Not enough clean data");

    const lastPrice =
      typeof meta.regularMarketPrice === "number"
        ? meta.regularMarketPrice
        : cleanCloses[cleanCloses.length - 1];

    return {
      symbol: meta.symbol || symbol,
      price: lastPrice,
      closes: cleanCloses,
      highs: cleanHighs,
      lows: cleanLows,
      volumes: cleanVolumes,
    };
  } catch (error) {
    console.warn("[ZAVIS] API 실패, 데모 데이터 사용:", error);
    showToast("⚠️ 실시간 데이터 접속 실패. 데모 모드로 실행합니다.");
    return generateDemoData(symbol);
  }
}

// 3-2. 환율(KRW=X)
async function fetchFxRate() {
  if (typeof fxRateKRW === "number") return fxRateKRW;

  try {
    const { lastClose } = await fetchYahooChart("KRW=X", "1d", "1d");
    if (typeof lastClose === "number") {
      fxRateKRW = lastClose;
      return fxRateKRW;
    }
  } catch (e) {
    console.warn("[ZAVIS] FX fetch error:", e);
  }
  return null;
}

// 3-3. 매크로 바 데이터 (+ Regime 태그)
async function fetchMacroData() {
  try {
    const [tnx, vix, krw, btc] = await Promise.all([
      fetchYahooChart("^TNX", "1d", "1d").catch(() => null),
      fetchYahooChart("^VIX", "1d", "1d").catch(() => null),
      fetchYahooChart("KRW=X", "1d", "1d").catch(() => null),
      fetchYahooChart("BTC-USD", "1d", "1d").catch(() => null),
    ]);

    // Regime 상태 값(색칠용)
    let riskState = "Neutral";
    let fxState = "Neutral";
    let cryptoState = "Neutral";

    // 미국10년물
    let rate = null;
    if (tnx) {
      rate = tnx.lastClose / 10; // 43.21 -> 4.32%
      $("macro-rate").textContent = rate.toFixed(2) + "%";
      let note = "중립 구간";
      if (rate < 3) note = "저금리, 성장주 우호";
      else if (rate > 5) note = "고금리, 변동성 주의";
      $("macro-rate-note").textContent = note;
    } else {
      $("macro-rate-note").textContent = "데이터 수신 실패";
    }

    // VIX
    let vixVal = null;
    if (vix) {
      vixVal = vix.lastClose;
      $("macro-vix").textContent = vixVal.toFixed(1);
      let note = "보통 변동성";
      if (vixVal < 15) note = "저변동성, 안정 구간";
      else if (vixVal > 25) note = "고변동성, 주의";
      $("macro-vix-note").textContent = note;
    } else {
      $("macro-vix-note").textContent = "데이터 수신 실패";
    }

    // KRW
    let krwVal = null;
    if (krw) {
      krwVal = krw.lastClose;
      $("macro-krw").textContent =
        "₩" + Math.round(krwVal).toLocaleString("ko-KR");
      let note = "중립 수준";
      if (krwVal > 1400) note = "원화 약세, 수출주 우호";
      else if (krwVal < 1300) note = "원화 강세, 수출주 부담";
      $("macro-krw-note").textContent = note;
      fxRateKRW = krwVal;
    } else {
      $("macro-krw-note").textContent = "데이터 수신 실패";
    }

    // BTC
    let btcVal = null;
    if (btc) {
      btcVal = btc.lastClose;
      $("macro-btc").textContent =
        "$" + Math.round(btcVal).toLocaleString("en-US");
      let note = "중립/보통";
      if (btcVal > 80000) note = "고점권, 변동 주의";
      else if (btcVal < 40000) note = "저점/조정 구간";
      $("macro-btc-note").textContent = note;
    } else {
      $("macro-btc-note").textContent = "데이터 수신 실패";
    }

    // --- Market Regime 태그 텍스트 ---
    const riskTag = $("regime-risk");
    const fxTag = $("regime-fx");
    const cryptoTag = $("regime-crypto");

    if (riskTag && rate != null && vixVal != null) {
      if (rate < 3 && vixVal < 18) {
        riskTag.textContent = "Risk On (성장주 우호)";
        riskState = "Risk On";
      } else if (rate > 5 || vixVal > 25) {
        riskTag.textContent = "Risk Off (방어주 선호)";
        riskState = "Risk Off";
      } else {
        riskTag.textContent = "Risk Neutral";
        riskState = "Neutral";
      }
    }

    if (fxTag && krwVal != null) {
      if (krwVal > 1400) {
        fxTag.textContent = "원화 약세 · 달러 강세";
        fxState = "약세";
      } else if (krwVal < 1300) {
        fxTag.textContent = "원화 강세 · 달러 약세";
        fxState = "강세";
      } else {
        fxTag.textContent = "환율 중립";
        fxState = "Neutral";
      }
    }

    if (cryptoTag && btcVal != null) {
      if (btcVal > 80000) {
        cryptoTag.textContent = "Crypto 과열 구간";
        cryptoState = "Hot";
      } else if (btcVal < 40000) {
        cryptoTag.textContent = "Crypto 침체/조정";
        cryptoState = "Cold";
      } else {
        cryptoTag.textContent = "Crypto 중립";
        cryptoState = "Neutral";
      }
    }

    // === 색상 클래스 실제 적용 ===
    updateRegimePills({
      risk: riskState,
      fx: fxState,
      crypto: cryptoState,
    });
  } catch (e) {
    console.warn("[ZAVIS] Macro fetch error:", e);
  }
}

// 4. 데모 데이터 생성기 (비상용, OHLC 포함)
function generateDemoData(symbol) {
  const closes = [];
  const highs = [];
  const lows = [];
  const volumes = [];

  let price = 100;

  for (let i = 0; i < 120; i++) {
    const change = (Math.random() - 0.45) * 0.05;
    price = price * (1 + change);

    const high = price * (1 + Math.random() * 0.01);
    const low = price * (1 - Math.random() * 0.01);

    closes.push(price);
    highs.push(high);
    lows.push(low);
    volumes.push(1000000 + Math.random() * 500000);
  }

  return {
    symbol: symbol,
    price: price,
    closes: closes,
    highs: highs,
    lows: lows,
    volumes: volumes,
  };
}

// 5. 지표 계산 엔진 (지지·저항 + R:R + 스코어)
function analyzeData(data) {
  const closes = data.closes;
  const highs = data.highs;
  const lows = data.lows;
  const volumes = data.volumes || [];
  const n = closes.length;

  const lastPrice = data.price || closes[n - 1];

  // === 이동평균 헬퍼 ===
  const ma = (period) => {
    if (n < period) return null;
    const slice = closes.slice(n - period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
  };

  const ma5 = ma(5);
  const ma20 = ma(20);
  const ma60 = ma(60);
  const ma120 = ma(120);

  // === RSI(14) ===
  let rsi = 50;
  if (n > 15) {
    let gains = 0;
    let losses = 0;
    for (let i = n - 14; i < n; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14 || 1e-9;
    const rs = avgGain / avgLoss;
    rsi = 100 - 100 / (1 + rs);
  }

  // === MACD (12,26 단순 버전) ===
  let macd = null;
  if (n >= 26) {
    const emaCalc = (period) => {
      const alpha = 2 / (period + 1);
      let ema = closes[n - period];
      for (let i = n - period + 1; i < n; i++) {
        ema = alpha * closes[i] + (1 - alpha) * ema;
      }
      return ema;
    };
    const ema12 = emaCalc(12);
    const ema26 = emaCalc(26);
    macd = ema12 - ema26;
  }

  // === 지지·저항 스윙 포인트 ===
  let support1 = null;
  let support2 = null;
  let resistance1 = null;
  let resistance2 = null;

  if (n >= 10) {
    const start = Math.max(1, n - 80);
    const swingLows = [];
    const swingHighs = [];

    for (let i = start; i < n - 1; i++) {
      const h = highs[i];
      const l = lows[i];

      if (h > highs[i - 1] && h > highs[i + 1]) {
        swingHighs.push(h);
      }
      if (l < lows[i - 1] && l < lows[i + 1]) {
        swingLows.push(l);
      }
    }

    const below = swingLows
      .filter((v) => v < lastPrice)
      .sort((a, b) => b - a);
    const above = swingHighs
      .filter((v) => v > lastPrice)
      .sort((a, b) => a - b);

    if (below.length > 0) support1 = below[0];
    if (below.length > 1) support2 = below[1];

    if (above.length > 0) resistance1 = above[0];
    if (above.length > 1) resistance2 = above[1];

    // 보정
    if (support1 === null) {
      const recentLows = lows.slice(Math.max(0, n - 60));
      const minLow = Math.min(...recentLows);
      if (minLow < lastPrice) support1 = minLow;
    }
    if (resistance1 === null) {
      const recentHighs = highs.slice(Math.max(0, n - 60));
      const maxHigh = Math.max(...recentHighs);
      if (maxHigh > lastPrice) resistance1 = maxHigh;
    }
  }

  // === 위/아래 여유 및 R:R ===
  let riskPct = null;
  let rewardPct1 = null;
  let rrRatio = null;

  if (support1 && support1 < lastPrice) {
    riskPct = ((lastPrice - support1) / lastPrice) * 100;
  }
  if (resistance1 && resistance1 > lastPrice) {
    rewardPct1 = ((resistance1 - lastPrice) / lastPrice) * 100;
  }
  if (
    typeof riskPct === "number" &&
    typeof rewardPct1 === "number" &&
    riskPct > 0
  ) {
    rrRatio = rewardPct1 / riskPct;
  }

  // === 타겟/손절 ===
  let stop = support1 ? support1 * 0.99 : lastPrice * 0.95;
  let target1, target2;

  if (resistance1) {
    target1 = resistance1 * 0.995;
    if (resistance2) {
      target2 = resistance2 * 0.99;
    } else {
      target2 = resistance1 * 1.05;
    }
  } else {
    target1 = lastPrice * 1.05;
    target2 = lastPrice * 1.15;
  }

  // === (NEW) 일일 변동률 & 거래량 비율 ===
  let dailyChangePct = null;
  if (n >= 2) {
    const prev = closes[n - 2];
    if (prev > 0) {
      dailyChangePct = ((lastPrice - prev) / prev) * 100;
    }
  }

  let volumeRatio = null;
  const vLen = volumes.length;
  if (vLen >= 21) {
    const todayVol = volumes[vLen - 1];
    const window = volumes.slice(vLen - 21, vLen - 1); // 직전 20일
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    if (avg > 0) volumeRatio = todayVol / avg;
  }

  // ===== ZAVIS v6.2 Scoring Engine =====
  let score = 50;
  const len = closes.length;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // (1) 단기 추세: 최근 5일 수익률
  let shortTrend = 0;
  if (len >= 6) {
    const base = closes[len - 6];
    shortTrend = ((lastPrice - base) / base) * 100;
  }
  score += clamp(shortTrend * 1.5, -15, 15);

  // (2) 중기 추세: 20 vs 60
  let midTrend = 0;
  if (ma20 && ma60) {
    midTrend = ((ma20 - ma60) / ma60) * 100;
    score += clamp(midTrend * 0.8, -12, 12);
  }

  // (3) RSI 구간 점수
  if (rsi < 25) {
    score += 12;
  } else if (rsi < 35) {
    score += 6;
  } else if (rsi > 75) {
    score -= 12;
  } else if (rsi > 65) {
    score -= 6;
  } else if (rsi >= 45 && rsi <= 60) {
    score += 4;
  }

  // (4) 20일선 이격
  let dist20 = 0;
  if (ma20) {
    dist20 = ((lastPrice - ma20) / ma20) * 100;
    const absDist = Math.abs(dist20);
    if (absDist < 2) score += 4;
    else if (absDist > 12) score -= 6;
  }

  // (5) 변동성 (최근 20일 수익률 표준편차)
  let volatility = 0;
  if (len >= 21) {
    const rets = [];
    for (let i = len - 20; i < len; i++) {
      const r = (closes[i] - closes[i - 1]) / closes[i - 1];
      rets.push(r);
    }
    const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
    const varSum = rets.reduce((s, r) => s + Math.pow(r - avg, 2), 0);
    volatility = Math.sqrt(varSum / rets.length) * 100;

    if (volatility > 6) score -= 5;
    else if (volatility > 0 && volatility < 2) score -= 2;
  }

  // (6) R:R 구조 반영
  if (typeof rrRatio === "number") {
    if (rrRatio >= 2) score += 10;
    else if (rrRatio < 1) score -= 10;
  }

  // 최종 스코어/랭크
  score = Math.round(Math.max(0, Math.min(99, score)));

  let rank = "C";
  if (score >= 85) rank = "S";
  else if (score >= 70) rank = "A";
  else if (score >= 55) rank = "B";
  else if (score < 35) rank = "D";

  return {
    price: lastPrice,
    ma5,
    ma20,
    ma60,
    ma120,
    rsi,
    macd,
    score,
    rank,
    support1,
    support2,
    resistance1,
    resistance2,
    riskPct,
    rewardPct1,
    rrRatio,
    target1,
    target2,
    stop,
    // NEW: 일일 변동률 & 거래량 비율
    dailyChangePct,
    volumeRatio,
  };
}

// 6. UI 업데이트
function updateUI(data, analysis, fxRate) {
  const priceEl = $("ticker-price");
  const scoreEl = $("ai-score");
  const rankEl = $("ai-rank");

  const trendEl = $("trend-txt");
  const momentumEl = $("momentum-txt");
  const waveEl = $("wave-txt");
  const supplyEl = $("supply-txt");
  const patternEl = $("pattern-txt");
  const newsEl = $("news-txt");
  const fundEl = $("fund-txt");

  const rsiBox = $("rsi-txt");
  const maBox = $("ma-txt");
  const macdBox = $("macd-txt");

  $("ticker-symbol").textContent = data.symbol;

  // 가격: USD + KRW
  let priceText = formatUSD(analysis.price);
  if (typeof fxRate === "number") {
    const krw = analysis.price * fxRate;
    priceText += " / ₩" + Math.round(krw).toLocaleString("ko-KR");
  }
  priceEl.textContent = priceText;

  // 점수 / 랭크
  scoreEl.textContent = analysis.score;
  rankEl.textContent = analysis.rank;

  const color =
    analysis.score >= 70
      ? "#10b981"
      : analysis.score >= 40
      ? "#3b82f6"
      : "#ef4444";
  scoreEl.style.color = color;
  rankEl.style.color = color;
  scoreEl.style.textShadow = `0 0 10px ${color}88`;
  rankEl.style.textShadow = `0 0 10px ${color}88`;

  // 상태 뱃지
  const badge = $("status-badge");
  badge.textContent =
    analysis.rank === "S" || analysis.rank === "A" ? "매수 우위" : "관망/주의";
  badge.style.backgroundColor = color;
  badge.style.color = "white";

  // === 메인 코멘트: UP/DOWN + R:R ===
  let mainComment = "분석 결과가 여기에 표시됩니다.";

  const upPctRaw = analysis.rewardPct1;
  const downPctRaw = analysis.riskPct;
  const rrRaw = analysis.rrRatio;

  const isValid =
    Number.isFinite(upPctRaw) &&
    Number.isFinite(downPctRaw) &&
    downPctRaw > 0 &&
    Number.isFinite(rrRaw);

  if (isValid) {
    const upPct = upPctRaw.toFixed(1);
    const downPct = downPctRaw.toFixed(1);
    const rrText = rrRaw.toFixed(2);

    let statusLabel = "[중립]";
    let statusColor = "#fbbf24";

    if (rrRaw >= 2) {
      statusLabel = "[매수 우위]";
      statusColor = "#10b981";
    } else if (rrRaw < 1) {
      statusLabel = "[주의]";
      statusColor = "#ef4444";
    }

    mainComment =
      `<span style="color:#10b981;">▲ UP: ${upPct}%</span> ` +
      `<span style="color:#ef4444; margin-left:6px;">▼ DOWN: ${downPct}%</span> ` +
      `<span style="color:#666; margin:0 6px;">·</span>` +
      `<span style="color:#3b82f6; font-weight:700;">R:R ≈ ${rrText} : 1</span> ` +
      `<span style="color:${statusColor}; font-weight:600; margin-left:6px;">${statusLabel}</span>`;
  } else {
    mainComment =
      "최근 구간에서 뚜렷한 지지·저항이 부족해, 기본 추세·모멘텀 기준으로만 평가합니다.";
  }

  $("main-comment").innerHTML = mainComment;

  // === 상세 섹터 텍스트 ===
  if (trendEl) {
    trendEl.textContent =
      analysis.ma20 && analysis.ma60 && analysis.ma20 > analysis.ma60
        ? "단기·중기 이평선 모두 우상향 — 상승 추세 구간."
        : "단기/중기 이평선 역배열 또는 약세 추세.";
  }

  if (momentumEl) {
    momentumEl.textContent = `RSI ${analysis.rsi.toFixed(
      1
    )} 기준, 모멘텀은 ${
      analysis.score > 50 ? "강세 우위" : "약세/중립"
    }로 판단.`;
  }

  if (waveEl) {
    if (
      analysis.support1 &&
      analysis.resistance1 &&
      analysis.riskPct &&
      analysis.rewardPct1
    ) {
      waveEl.textContent =
        `현재가(${formatUSD(analysis.price)}) 기준 ` +
        `주요 지지선: ${formatUSD(analysis.support1)}, ` +
        `주요 저항선: ${formatUSD(analysis.resistance1)}. ` +
        `위로 +${analysis.rewardPct1.toFixed(
          1
        )}%, 아래로 -${analysis.riskPct.toFixed(1)}% 여유.`;
    } else {
      waveEl.textContent =
        `현재가(${formatUSD(analysis.price)})가 20일선(${formatUSD(
          analysis.ma20 || analysis.price
        )}) 기준으로 위치를 형성 중입니다.`;
    }
  }

  // === (NEW) 투자대회식 해석 – Supply / Pattern / News ===
  const chg = analysis.dailyChangePct;
  const vr = analysis.volumeRatio;

  // Supply: 거래량 비율 기반
  if (supplyEl) {
    let txt = "거래량 데이터 기준, 수급은 중립 수준으로 판단됩니다.";

    if (vr != null) {
      if (vr >= 2) {
        txt =
          `오늘 거래량이 최근 20일 평균의 약 ${vr.toFixed(
            1
          )}배 수준으로 급증한 상태입니다. ` +
          "단기 수급이 한쪽으로 쏠린 구간으로, 방향이 맞으면 시세가 크게 나지만 역방향 진입 시 손절 기준을 더 엄격히 잡는 것이 좋습니다.";
      } else if (vr >= 1.3) {
        txt =
          `거래량이 최근 평균 대비 약 ${vr.toFixed(
            1
          )}배로 늘어난 상태 — 수급이 슬슬 붙기 시작하는 구간입니다. ` +
          "기관/큰손 참여 여부는 HTS 체결창과 프로그램 매매를 함께 확인하는 것이 좋습니다.";
      } else if (vr <= 0.6) {
        txt =
          "거래량이 평소 대비 크게 줄어든 상태입니다. 방향성이 맞더라도 체결이 잘 안 될 수 있고," +
          " 단기 트레이딩 관점에서는 매매 매력이 떨어지는 구간에 가깝습니다.";
      } else {
        txt =
          "거래량은 최근 평균 수준과 비슷한 ‘일상적인 수급’ 구간입니다. " +
          "추세·지지/저항 신호가 더 중요하게 작동하는 자리로 볼 수 있습니다.";
      }
    }

    supplyEl.textContent = txt;
  }

  // Pattern: 일일 변동률 + 지지/저항 위치로 시나리오 설명
  if (patternEl) {
    let txt =
      "특정 패턴(삼각수렴, 박스, 헤드앤숄더 등)을 자동 인식하진 않지만, 가격 위치 관점에서 체크가 필요합니다.";

    const nearSupport =
      analysis.support1 && analysis.price
        ? ((analysis.price - analysis.support1) / analysis.price) * 100
        : null;
    const nearResistance =
      analysis.resistance1 && analysis.price
        ? ((analysis.resistance1 - analysis.price) / analysis.price) * 100
        : null;

    if (nearSupport != null && nearSupport >= 0 && nearSupport <= 3) {
      txt =
        "주요 지지선 바로 위 구간에서 거래되고 있어 ‘눌림목’ 패턴 가능성이 있는 자리입니다. " +
        "지지선 이탈 시 손절, 유지 시 재차 반등 패턴을 노려볼 수 있는 구간입니다.";
    } else if (
      nearResistance != null &&
      nearResistance >= 0 &&
      nearResistance <= 3
    ) {
      txt =
        "상단 저항선 근처에서 공방 중인 구간입니다. " +
        "돌파 시 추세가 한 단계 위로 레벨업될 수 있지만, 돌파 실패 시 단기 조정 파동이 나올 수 있는 자리라 분할 매도/재진입 전략이 유효한 구간입니다.";
    } else if (chg != null && Math.abs(chg) >= 5) {
      txt =
        `일일 변동률이 약 ${chg.toFixed(
          1
        )}%로 크게 출렁인 세션입니다. ` +
        "뉴스·실적·가이던스 등 이벤트성 재료가 개입됐을 가능성이 높은 구간이므로, 단순 기술적 패턴보다 재료 확인이 우선입니다.";
    }

    patternEl.textContent = txt;
  }

  // News & Sentiment: 변동률 기준으로 체크 포인트 제시
  if (newsEl) {
    let txt =
      "현재 엔진에는 실시간 뉴스/심리 데이터가 직접 연동되어 있지 않습니다. " +
      "다만 가격 움직임 기준으로 체크가 필요한 포인트는 다음과 같습니다. ";

    if (chg != null && chg >= 3) {
      txt +=
        "당일 강한 양봉/갭상승이 나온 상태라, 실적 서프라이즈·가이던스 상향·정책/규제 완화·인수합병(M&A) 관련 뉴스를 우선적으로 확인하는 것이 좋습니다.";
    } else if (chg != null && chg <= -3) {
      txt +=
        "당일 급락/갭하락이 발생한 상태라, 실적 쇼크·가이던스 하향·규제 이슈·악성 리포트(투자의견 하향) 여부를 먼저 체크해야 합니다.";
    } else {
      txt +=
        "변동성이 크지 않은 구간으로, 섹터 전체 뉴스나 향후 실적/밸류에이션 스토리가 어떻게 전개되는지 점검하는 정도면 충분한 구간입니다.";
    }

    newsEl.textContent = txt;
  }

  // Fundamentals 더미 텍스트는 기존 유지
  if (fundEl) {
    fundEl.textContent =
      "실적·밸류에이션(PSR, PER, FCF 등)은 비연동 상태 — 컨센서스/리포트 추가 확인 권장.";
  }

  // === 지표 박스 ===
  if (rsiBox) {
    let mood = "중립";
    if (analysis.rsi >= 70) mood = "과열";
    else if (analysis.rsi >= 60) mood = "강세";
    else if (analysis.rsi <= 30) mood = "과매도";
    else if (analysis.rsi <= 40) mood = "약세";
    rsiBox.textContent = `${analysis.rsi.toFixed(1)} (${mood})`;
  }

  if (maBox) {
    if (analysis.ma20 && analysis.ma60) {
      let maMood = "중립/조정";
      if (analysis.ma20 > analysis.ma60) maMood = "상승(골든크로스 우위)";
      else if (analysis.ma20 < analysis.ma60) maMood = "하락(데드크로스 우위)";
      maBox.textContent = `${analysis.ma20.toFixed(
        2
      )} / ${analysis.ma60.toFixed(2)} (${maMood})`;
    } else {
      maBox.textContent = "데이터 부족";
    }
  }

  if (macdBox) {
    if (analysis.macd == null) {
      macdBox.textContent = "데이터 부족";
    } else {
      const mood = analysis.macd > 0 ? "상승 에너지" : "하락 에너지";
      macdBox.textContent = `${analysis.macd.toFixed(2)} (${mood})`;
    }
  }

  // 타겟/손절
  $("target1").textContent = formatUSD(analysis.target1);
  $("target2").textContent = formatUSD(analysis.target2);
  $("stoploss").textContent = formatUSD(analysis.stop);

  // ------------------------------------
  // 차트 (TradingView Advanced Chart)
  // ------------------------------------
  $("chart-container").innerHTML = "";

  if (window.TradingView) {
    new TradingView.widget({
      symbol: data.symbol,
      interval: "D",
      container_id: "chart-container",
      autosize: true,
      theme: "dark",
      style: "1", // 캔들
      locale: "kr",
      timezone: "Etc/UTC",
      hide_top_toolbar: false,
      hide_legend: false,
      withdateranges: true,
      enable_publishing: false,
      allow_symbol_change: false,
      studies: [
        "RSI@tv-basicstudies",
        "MACD@tv-basicstudies",
        "BB@tv-basicstudies",
        "MAExp@tv-basicstudies",
        "MAExp@tv-basicstudies",
        "MAExp@tv-basicstudies",
        "MAExp@tv-basicstudies",
        "MAExp@tv-basicstudies",
      ],
    });
  } else {
    console.warn("[ZAVIS] TradingView not loaded");
  }

  // --- 전략 요약 박스 업데이트 ---
  const strategyMainEl = $("strategy-main");
  const strategyDetailEl = $("strategy-detail");

  if (strategyMainEl && strategyDetailEl) {
    const {
      price,
      rsi,
      support1,
      resistance1,
      riskPct,
      rewardPct1,
      rrRatio,
    } = analysis;

    const nearSupport =
      support1 && price ? ((price - support1) / price) * 100 : null;
    const nearResistance =
      resistance1 && price ? ((resistance1 - price) / price) * 100 : null;

    let scenario = "중립 구간";
    let detail =
      "추세·모멘텀·지지/저항이 모두 애매한 구간으로, 확신이 없다면 관망을 권장합니다.";

    // ① 지지선 근처 + R:R 양호 → 눌림 매수
    if (
      nearSupport !== null &&
      nearSupport >= 0 &&
      nearSupport <= 3 &&
      rrRatio &&
      rrRatio >= 1.5 &&
      rsi >= 30 &&
      rsi <= 60
    ) {
      scenario = "지지선 부근 눌림 매수 시나리오";
      detail =
        "주요 지지선 근처에서 눌림이 나온 구간으로, 손절 폭 대비 상승 여력이 더 큰 자리입니다. " +
        "지지선 이탈 시에는 신속한 손절 관리가 필요합니다.";
    }
    // ② 저항선 근처 + RSI 과열 → 돌파 관찰/부분청산
    else if (
      nearResistance !== null &&
      nearResistance >= 0 &&
      nearResistance <= 3 &&
      rsi >= 60
    ) {
      scenario = "저항선 돌파 관찰 / 부분청산 구간";
      detail =
        "주요 저항선 인근 구간으로, 돌파 시 추가 시세가 나올 수 있지만 " +
        "되밀릴 경우 단기 조정이 나올 수 있는 자리입니다. 일부 분할 매도 또는 관망 전략이 유효합니다.";
    }
    // ③ RSI 과매도 → 역추세 반등(고위험)
    else if (rsi < 30) {
      scenario = "역추세 반등(고위험) 시나리오";
      detail =
        "RSI 기준 과매도 구간으로, 단기 반등이 나올 수 있지만 추세 자체는 약세입니다. " +
        "짧은 손절과 소액/분할 진입 중심의 고위험 전략 구간입니다.";
    }
    // ④ R:R가 1 미만 → 리스크/보상 비대칭
    else if (rrRatio && rrRatio < 1) {
      scenario = "리스크 대비 보상이 불리한 구간";
      detail =
        "현재 손절까지의 리스크가 위쪽 기대수익보다 큰 구조입니다. " +
        "새로운 진입보다는 기존 보유분 관리 또는 관망이 더 유리한 자리입니다.";
    }

    let rrSentence = "";
    if (
      Number.isFinite(rewardPct1) &&
      Number.isFinite(riskPct) &&
      Number.isFinite(rrRatio) &&
      riskPct > 0
    ) {
      rrSentence =
        `현재 위쪽 기대수익은 약 +${rewardPct1.toFixed(
          1
        )}%, ` +
        `손절까지 하방 리스크는 약 -${riskPct.toFixed(
          1
        )}%로, ` +
        `R:R ≈ ${rrRatio.toFixed(2)} : 1 수준입니다. `;
    }

    strategyMainEl.textContent = scenario;
    strategyDetailEl.textContent = rrSentence + detail;
  }

  // 포지션 계산기 기본 진입가를 현재가로 자동 세팅
  const entryInput = $("pos-entry");
  if (entryInput && Number.isFinite(analysis.price)) {
    entryInput.value = analysis.price.toFixed(2);
  }
}

// ─────────────────────────────────────
// 6-1. Market Regime Pill 색상 적용 함수
// ─────────────────────────────────────
function updateRegimePills(regime) {
  const riskPill = $("regime-risk");
  const fxPill = $("regime-fx");
  const cryptoPill = $("regime-crypto");
  if (!riskPill || !fxPill || !cryptoPill) return;

  const all = [riskPill, fxPill, cryptoPill];

  all.forEach((p) =>
    p.classList.remove(
      "regime-pill-neutral",
      "regime-pill-riskon",
      "regime-pill-riskoff",
      "regime-pill-fx-weak",
      "regime-pill-fx-strong",
      "regime-pill-crypto-hot",
      "regime-pill-crypto-cold"
    )
  );

  // Risk
  if (regime.risk === "Risk On") {
    riskPill.classList.add("regime-pill-riskon");
  } else if (regime.risk === "Risk Off") {
    riskPill.classList.add("regime-pill-riskoff");
  } else {
    riskPill.classList.add("regime-pill-neutral");
  }

  // FX
  if (regime.fx === "약세") {
    fxPill.classList.add("regime-pill-fx-weak");
  } else if (regime.fx === "강세") {
    fxPill.classList.add("regime-pill-fx-strong");
  } else {
    fxPill.classList.add("regime-pill-neutral");
  }

  // Crypto
  if (regime.crypto === "Hot") {
    cryptoPill.classList.add("regime-pill-crypto-hot");
  } else if (regime.crypto === "Cold") {
    cryptoPill.classList.add("regime-pill-crypto-cold");
  } else {
    cryptoPill.classList.add("regime-pill-neutral");
  }
}

// 7. 메인 실행 함수
async function runAnalysis() {
  const input = $("ticker-input");
  const ticker = input.value.trim();

  if (!ticker) {
    showToast("티커를 입력해주세요!");
    input.focus();
    return;
  }

  showLoading(true);

  setTimeout(async () => {
    try {
      const data = await fetchStockData(ticker);
      const fx = await fetchFxRate();
      const analysis = analyzeData(data);

      // 포지션 계산기에서 쓸 마지막 분석 결과 저장
      lastAnalysis = analysis;

      updateUI(data, analysis, fx);
    } catch (e) {
      console.error("[ZAVIS] 분석 중 오류:", e);
      showToast("분석 중 오류가 발생했습니다.");
    } finally {
      showLoading(false);
    }
  }, 300);
}

// 8. 이벤트 리스너 & 포지션 사이즈 계산기
window.onload = function () {
  console.log("[ZAVIS] System Ready");

  $("search-btn").addEventListener("click", runAnalysis);

  $("ticker-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runAnalysis();
    }
  });

  const posBtn = $("pos-calc-btn");
  if (posBtn) {
    posBtn.addEventListener("click", calcPositionSize);
  }

  // 상단 매크로 바 로딩
  fetchMacroData();
};

// 포지션 사이즈 계산기 로직
function calcPositionSize() {
  if (!lastAnalysis) {
    showToast("먼저 티커 분석을 실행해주세요.");
    return;
  }

  const capInput = $("pos-capital");
  const riskInput = $("pos-risk");
  const entryInput = $("pos-entry");
  const sizeSpan = $("pos-size");
  const riskAmtSpan = $("pos-risk-amount");
  const hint = $("pos-hint");

  if (!capInput || !riskInput || !entryInput) return;

  const capital = parseFloat(capInput.value);
  const riskPct = parseFloat(riskInput.value);
  let entry = parseFloat(entryInput.value);

  if (!Number.isFinite(capital) || capital <= 0) {
    showToast("총 자본(USD)을 입력해주세요.");
    capInput.focus();
    return;
  }

  if (!Number.isFinite(riskPct) || riskPct <= 0) {
    showToast("트레이드당 리스크(%)를 입력해주세요.");
    riskInput.focus();
    return;
  }

  // 진입가 비어 있으면 현재가로 자동 사용
  if (!Number.isFinite(entry) || entry <= 0) {
    entry = lastAnalysis.price;
    entryInput.value = entry.toFixed(2);
  }

  const stop = lastAnalysis.stop;
  if (!Number.isFinite(stop) || stop <= 0) {
    showToast("손절가 정보가 없어 계산할 수 없습니다.");
    return;
  }

  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare <= 0) {
    showToast("진입가와 손절가의 차이가 0입니다. 손절 위치를 확인해주세요.");
    return;
  }

  const riskAmount = capital * (riskPct / 100); // 계좌에서 허용할 손실 금액
  const rawShares = Math.floor(riskAmount / riskPerShare);

  if (!Number.isFinite(rawShares) || rawShares <= 0) {
    showToast("현재 손절 위치 기준으로는 리스크가 너무 큽니다.");
    sizeSpan.textContent = "수량: 계산 불가";
    riskAmtSpan.textContent = `손실 한도: ${formatUSD(riskAmount)}`;
    return;
  }

  sizeSpan.textContent = `수량: 약 ${rawShares.toLocaleString("en-US")}주`;
  riskAmtSpan.textContent = `손실 한도: ${formatUSD(riskAmount)}`;
  hint.textContent =
    `진입가 ${formatUSD(entry)} / 손절가 ${formatUSD(
      stop
    )} 기준, ` +
    `계좌 ${formatUSD(capital)}에서 ${riskPct.toFixed(
      2
    )}% 리스크를 사용하는 포지션 크기입니다.`;
}
