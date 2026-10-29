// Scanner UI features that are switched off for now. Flip a flag to bring the control back:
// the underlying logic (both pairings, both strategy versions) still runs underneath.
//
// With the version toggle hidden the scanner uses DEFAULT_STRATEGY_VERSION, and with the pairing
// tabs hidden it shows the 4H bias -> 15m entry table. Alerts keep watching both pairings.
export const SHOW_STRATEGY_VERSION_TOGGLE = false;
export const SHOW_PAIRING_TABS = false;
