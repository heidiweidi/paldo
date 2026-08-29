// Original illustrative diagram of the entry checklist used by this scanner:
// Liquidity Sweep -> Market Structure Shift (MSS) -> Breaker Block -> Fair
// Value Gap (FVG) -> entry sized to a 1:2 risk/reward. This is a generic,
// hand-drawn example (not any specific asset's real chart) built to match the
// site's own dark theme — it exists purely so a reader unfamiliar with the
// ICT/SMC checklist terms above can see what the pattern looks like on a
// candlestick chart before checking the live numbers for this asset.
export default function StrategyDiagram() {
  const LONG = "var(--long)";
  const SHORT = "var(--short)";
  const WARN = "var(--warn)";
  const ACCENT = "var(--accent)";
  const MUTED = "var(--muted)";
  const TXT = "var(--txt)";

  // Candles: [x, wickTop, wickBottom, bodyTop, bodyBottom, color]
  // (y grows downward; smaller y = higher price)
  const candles = [
    [40, 120, 150, 125, 145, LONG],
    [90, 100, 135, 105, 130, LONG],
    [140, 110, 160, 115, 150, SHORT],
    [190, 150, 200, 155, 195, SHORT],
    [240, 195, 240, 200, 235, SHORT],
    [290, 225, 262, 230, 258, SHORT], // swing-low pivot candle
    [340, 232, 285, 240, 258, WARN],  // sweep: wicks below the pivot, closes back above
    [390, 140, 250, 145, 230, LONG],  // MSS break candle — closes back above the shift level
    [440, 145, 178, 150, 172, SHORT], // small pullback into the FVG
    [490, 100, 160, 105, 150, LONG],
    [540, 60, 120, 65, 115, LONG],
    [590, 20, 90, 25, 85, LONG],
  ];

  return (
    <svg viewBox="0 0 680 340" width="100%" height="auto" role="img" aria-label="Diagram of the Liquidity Sweep, Market Structure Shift, Breaker Block, Fair Value Gap, 1:2 risk/reward entry checklist">
      {/* risk (red) / reward (green) bands, drawn first so candles sit on top */}
      <rect x="0" y="170" width="680" height="60" fill={SHORT} opacity="0.12" />
      <rect x="0" y="50" width="680" height="120" fill={LONG} opacity="0.12" />

      {/* swing-low / liquidity sweep level */}
      <line x1="260" y1="228" x2="640" y2="228" stroke={MUTED} strokeDasharray="4 4" strokeWidth="1.5" />
      <text x="30" y="224" fill={WARN} fontSize="12" fontWeight="700">① Liquidity Sweep</text>
      <line x1="30" y1="228" x2="255" y2="228" stroke={MUTED} strokeDasharray="4 4" strokeWidth="1" opacity="0.5" />

      {/* MSS level */}
      <line x1="30" y1="150" x2="410" y2="150" stroke={ACCENT} strokeDasharray="4 4" strokeWidth="1.5" />
      <text x="415" y="147" fill={ACCENT} fontSize="12" fontWeight="700">② MSS</text>

      {/* breaker block highlight (candle 5, the last down candle before the break) */}
      <rect x="283" y="222" width="14" height="42" fill="none" stroke={TXT} strokeDasharray="2 2" strokeWidth="1.2" />
      <text x="245" y="300" fill={TXT} fontSize="12" fontWeight="700">③ Breaker Block</text>
      <line x1="290" y1="264" x2="290" y2="292" stroke={TXT} strokeWidth="1" opacity="0.6" />

      {/* FVG zone */}
      <rect x="418" y="150" width="55" height="60" fill={ACCENT} opacity="0.18" />
      <text x="420" y="145" fill={ACCENT} fontSize="12" fontWeight="700">④ FVG</text>

      {/* candles */}
      {candles.map(([x, wt, wb, bt, bb, color], i) => (
        <g key={i}>
          <line x1={x + 7} y1={wt} x2={x + 7} y2={wb} stroke={color} strokeWidth="2" />
          <rect x={x} y={bt} width="14" height={Math.max(2, bb - bt)} fill={color} />
        </g>
      ))}

      {/* entry / stop / target */}
      <line x1="0" y1="170" x2="680" y2="170" stroke={WARN} strokeDasharray="6 3" strokeWidth="1.5" />
      <text x="600" y="167" fill={WARN} fontSize="12" fontWeight="700">Entry</text>
      <line x1="0" y1="230" x2="680" y2="230" stroke={SHORT} strokeWidth="1.5" />
      <text x="600" y="245" fill={SHORT} fontSize="12" fontWeight="700">Stop</text>
      <line x1="0" y1="50" x2="680" y2="50" stroke={LONG} strokeWidth="1.5" />
      <text x="592" y="45" fill={LONG} fontSize="12" fontWeight="700">⑤ Target (1:2)</text>
    </svg>
  );
}
