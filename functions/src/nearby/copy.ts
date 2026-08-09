/**
 * TRN 058E — Arabic nearby notification copy (pure).
 * Neutral situational wording. Never official / evasion.
 */

import type { NearbyNotificationPushCategory } from "../shared/nearbyNotificationRadii"

export type NearbyNotificationCopy = {
  title: string
  body: string
}

const COPY: Record<NearbyNotificationPushCategory, NearbyNotificationCopy> = {
  accident: {
    title: "حادث قريب منك",
    body: "بلاغ من دراج عن حادث قريب من منطقتك. انتبه على الطريق.",
  },
  checkpoint: {
    title: "حاجز قريب منك",
    body: "بلاغ عن حاجز قريب من منطقتك.",
  },
  road_closed: {
    title: "طريق مسكر قريب منك",
    body: "بلاغ من دراج عن طريق مسكر قريب من منطقتك.",
  },
  slippery_road: {
    title: "طريق زلق قريب منك",
    body: "بلاغ من دراج عن طريق زلق قريب من منطقتك.",
  },
  fire: {
    title: "حريق قريب منك",
    body: "بلاغ من دراج عن حريق قريب من منطقتك.",
  },
  gunfire: {
    title: "بلاغ مهم قريب منك",
    body: "بلاغ من دراج عن إطلاق نار في المنطقة. انتبه وخليك حذر.",
  },
  explosionStrike: {
    title: "بلاغ مهم في منطقتك",
    body: "بلاغ من دراج عن انفجار / غارة في المنطقة.",
  },
  collapseDanger: {
    title: "خطر قريب منك",
    body: "بلاغ عن انهيار / خطر كبير في المنطقة.",
  },
}

export function nearbyNotificationCopyForCategory(
  category: string | null | undefined
): NearbyNotificationCopy | null {
  if (!category || !(category in COPY)) return null
  return COPY[category as NearbyNotificationPushCategory]
}

/** Guardrails for tests / review — no official or evasion phrasing. */
export const NEARBY_COPY_FORBIDDEN_PHRASES = [
  "مؤكد",
  "رسمي",
  "verified",
  "official",
  "confirmed",
  "تجنب الشرطة",
  "تفادي الشرطة",
  "غيّر طريقك لتفادي",
] as const
