import { STRATEGIES, STRATEGY_VERSIONS } from "@/lib/indicators";
import { SHOW_PAIRING_TABS, SHOW_STRATEGY_VERSION_TOGGLE } from "@/lib/uiFlags";

const STRAT = STRATEGIES.strat5;

// The scanner's "how to read it" and strategy notes. Shown only from the header menu so the
// scanner itself stays clean.
export default function HelpContent() {
  return (
    <div className="help">
      <details open>
        <summary>How to read the scanner</summary>
        <ul>
          <li>
            Each row is one asset. The table shows <b>Asset, Price, Chg%, Grade, Bias, Entry, Stop, TP1, TP2</b> and <b>POI</b>.
            Click the arrow to expand the full breakdown; click the symbol to open its chart in a new tab.
          </li>
          <li>
            <b>Bias</b> is the higher-timeframe reversal direction (a sweep followed by a structure shift). The lower-timeframe
            Sweep / MSS / FVG columns are the entry checklist, detected independently.
          </li>
          <li>
            A row shows Entry, Stop, TP1 and TP2 as soon as the lower-timeframe checklist completes and agrees with the
            higher-timeframe bias. That is the whole of <b>{STRAT.name}</b>.
          </li>
          <li>
            The expanded row has the annotated Position chart, the Sweep / MSS / Breaker / FVG checklist, the ADX / Volatility /
            Volume readings, bars since MSS and <b>Still catchable</b>.
          </li>
        </ul>
      </details>

      <details>
        <summary>{STRAT.name}: the checklist</summary>
        <ul>
          <li>
            <b>Liquidity Sweep</b> → <b>Market Structure Shift (MSS)</b> → <b>Breaker Block</b> → <b>Fair Value Gap (FVG)</b>.
            That checklist alone decides whether a setup exists.
          </li>
          <li>
            <b>Entry</b> is the middle of the lower-timeframe FVG. <b>Stop</b> is the lower-timeframe sweep candle&apos;s wick extreme.
          </li>
          <li>
            <b>Breaker Block is never automated.</b> It is shown as a candidate to confirm yourself on the chart before entering.
          </li>
          <li>
            <b>ADX, Volatility and Volume are filters, not conditions.</b> Leave them off to see every valid setup, or switch one on
            to narrow the list. The count of setups a filter hides is always shown next to it. Gating on them was hiding too many
            valid, profitable entries.
          </li>
        </ul>
      </details>

      <details>
        <summary>Targets: why two</summary>
        <ul>
          <li>
            <b>TP1 at 1:1</b> banks half and de-risks. <b>TP2 at 1:2</b> is the runner.
          </li>
          <li>
            Sending the whole position to the next liquidity pool made reward-to-risk swing with however far that pool sat, often
            4 to 5R, which reads well but rarely fills. Fixed 1:1 and 1:2 targets are far likelier to actually be reached; scale out
            at TP1 and the rest runs risk-free.
          </li>
          <li>
            <b>POI</b> (point of interest) is context, not an exit: the next unswept liquidity on the bias timeframe, with its
            distance in R. Comfortably beyond TP2 means the runner has room; closer than TP2 means price may stall before it.
          </li>
        </ul>
      </details>

      <details>
        <summary>Grade (A+, A, B)</summary>
        <ul>
          <li>
            Structural quality out of 11: room to TP2 (3), trend strength (2), MSS participation (2), freshness (2), volatility (1),
            breaker candidate (1).
          </li>
          <li>
            <b>A+</b> is 8 or more, <b>A</b> is 5 to 7, <b>B</b> is below 5.
          </li>
          <li>
            Timing is deliberately excluded, so a grade does not flicker as price wanders. Expand a row to see exactly which
            factors earned or lost points.
          </li>
        </ul>
      </details>

      <details>
        <summary>Still catchable?</summary>
        <p>Compares the current price to entry, stop and target, not just bar count.</p>
        <ul>
          <li><b>In zone</b>: price has pulled back to the gap. This is your window.</li>
          <li><b>Running</b>: price never pulled back and is already headed to target. Chasing it now is worse risk/reward than planned.</li>
          <li><b>TP1 hit</b>: the runner is still open, so it is still a live position.</li>
          <li><b>Target reached</b> or <b>Invalidated</b>: the move has already played out one way or the other.</li>
        </ul>
      </details>

      <details>
        <summary>Alerts and journal</summary>
        <ul>
          <li>
            <b>Alerts</b> push entry, TP1, TP2 and stop to Discord as they happen. They watch both timeframe pairings
            (4H → 15m and 1H → 5m){SHOW_PAIRING_TABS ? "" : "; the 1H → 5m table is hidden for now"} and ignore the table filters.
          </li>
          <li>
            <b>Journal</b> logs setups you actually took and tracks outcomes and realised R. It is stored in this browser only.
          </li>
        </ul>
      </details>

      <details>
        <summary>Coin lists</summary>
        <ul>
          <li><b>Curated list</b>: a fixed set of liquid coins, candles from Binance.</li>
          <li><b>Top by market cap</b>: the current top N coins from CoinGecko, candles from Binance. Coins not listed as a USDT pair on Binance are skipped.</li>
          <li>
            <b>Bitunix</b>: the most traded USDT perpetuals listed on Bitunix, ranked by 24h volume, with candles from Bitunix
            itself. Bitunix also lists tokenized stocks, ETFs and commodities, so those appear alongside the coins.
          </li>
          <li>Forex and gold always come from Yahoo Finance.</li>
        </ul>
      </details>

      {SHOW_STRATEGY_VERSION_TOGGLE ? (
        <details>
          <summary>{STRAT.name} versions</summary>
          <ul>
            {Object.values(STRATEGY_VERSIONS).map((v) => (
              <li key={v.id}><b>{v.label}</b>: {v.short}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <details>
        <summary>Data and disclaimer</summary>
        <p>
          Educational signal simulation on live public data, not financial advice. Verify every level on your own charts before
          acting. Crypto candles come from Binance (or Bitunix in Bitunix mode), forex and gold from Yahoo Finance, all proxied
          through this site&apos;s edge API.
        </p>
      </details>
    </div>
  );
}
