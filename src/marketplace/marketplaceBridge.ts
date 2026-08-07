/**
 * Totimoto marketplace bridge — external links only.
 * TRN does not host marketplace data, markers, or commerce.
 */

export const MARKETPLACE_ORIGIN = "https://www.totimoto.com"

/** Browse motorcycles for sale (verified live homepage marketplace). */
export const MARKETPLACE_BUY_URL = `${MARKETPLACE_ORIGIN}/`

/** List a bike for sale (verified sell page). */
export const MARKETPLACE_SELL_URL = `${MARKETPLACE_ORIGIN}/pages/list-sell-your-bike`

export const MARKETPLACE_COPY = {
  sectionLabel: "الدراجات",
  entryLabel: "أعرض أو اشتري دراجة",
  entryHint: "السوق على Totimoto — شراء أو بيع",
  sheetTitle: "الدراجات",
  sheetPrompt: "شو بدك تعمل؟",
  buyTitle: "شراء دراجة",
  buyHint: "شوف الدراجات المعروضة على Totimoto",
  sellTitle: "بيع دراجتي",
  sellHint: "أعرض دراجتك للبيع على Totimoto",
  footer: "السوق على Totimoto.com",
} as const

export type MarketplaceDestination = "buy" | "sell"

export function marketplaceUrlFor(destination: MarketplaceDestination): string {
  return destination === "buy" ? MARKETPLACE_BUY_URL : MARKETPLACE_SELL_URL
}

/**
 * Open Totimoto in a new browsing context so the TRN PWA stays available.
 * Uses noopener/noreferrer for security. No analytics platform wired yet —
 * keep this as the single hook for marketplace_buy_open / marketplace_sell_open.
 */
export function openMarketplaceDestination(
  destination: MarketplaceDestination
): boolean {
  const url = marketplaceUrlFor(destination)
  // Future analytics: marketplace_buy_open / marketplace_sell_open
  try {
    if (typeof window === "undefined" || typeof window.open !== "function") {
      return false
    }
    const opened = window.open(url, "_blank", "noopener,noreferrer")
    return opened != null
  } catch {
    return false
  }
}

/** Safe link attributes when rendering <a> (tests / future markup). */
export const MARKETPLACE_LINK_REL = "noopener noreferrer" as const
