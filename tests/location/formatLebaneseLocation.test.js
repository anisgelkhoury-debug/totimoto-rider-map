/**
 * TRN Task 033 — Lebanese location extractor + formatter unit tests.
 * Run: node --experimental-strip-types --test tests/location/formatLebaneseLocation.test.js
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  extractStreetFromNominatimAddress,
  formatLebaneseLocationConcise,
  formatLebaneseLocationDetailed,
  parseNominatimToLocationInfo,
} from "../../src/utils/formatLebaneseLocation.ts"

function caseResult(label, street, concise, detailed) {
  return { label, street, concise, detailed }
}

describe("TRN location intelligence — street extract + labels", () => {
  it("1. Bliss Street / Hamra / Beirut", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        road: "Bliss Street",
        neighbourhood: "Hamra",
        city: "Beirut",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "Bliss Street")
    assert.equal(concise, "Bliss Street • Hamra • Beirut")
    assert.equal(detailed, "Bliss Street • Hamra • Beirut")
    console.log(caseResult("1 Bliss/Hamra/Beirut", parsed.street, concise, detailed))
  })

  it("2. Alfred Naccache Street / Achrafieh / Beirut with landmark", () => {
    const parts = {
      locationName: "ABC Achrafieh",
      street: "Alfred Naccache Street",
      area: "Achrafieh",
      city: "Beirut",
      district: "",
    }
    const street = extractStreetFromNominatimAddress({
      road: "Alfred Naccache Street",
      suburb: "Achrafieh",
      city: "Beirut",
    })
    const concise = formatLebaneseLocationConcise(parts)
    const detailed = formatLebaneseLocationDetailed(parts)
    assert.equal(street, "Alfred Naccache Street")
    assert.equal(concise, "Alfred Naccache Street • Achrafieh • Beirut")
    assert.equal(
      detailed,
      "ABC Achrafieh • Alfred Naccache Street • Achrafieh • Beirut"
    )
    console.log(caseResult("2 Alfred/Achrafieh", street, concise, detailed))
  })

  it("3. Hamra without a returned street", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        neighbourhood: "Hamra",
        city: "Beirut",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "")
    assert.equal(concise, "Hamra • Beirut")
    assert.equal(detailed, "Hamra • Beirut")
    console.log(caseResult("3 Hamra no street", parsed.street, concise, detailed))
  })

  it("4. Jounieh street / Jounieh / Keserwan", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        road: "Maameltein Road",
        city: "Jounieh",
        county: "Keserwan",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "Maameltein Road")
    assert.equal(concise, "Maameltein Road • Jounieh")
    assert.ok(detailed.includes("Maameltein Road"))
    assert.ok(detailed.includes("Jounieh"))
    assert.ok(detailed.includes("Keserwan"))
    console.log(caseResult("4 Jounieh", parsed.street, concise, detailed))
  })

  it("5. Tripoli street / Tripoli", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        road: "Syriac Street",
        city: "Tripoli",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "Syriac Street")
    assert.equal(concise, "Syriac Street • Tripoli")
    assert.equal(detailed, "Syriac Street • Tripoli")
    console.log(caseResult("5 Tripoli", parsed.street, concise, detailed))
  })

  it("6. Saida street / Saida", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        road: "Riad El Solh Street",
        town: "Saida",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "Riad El Solh Street")
    assert.equal(concise, "Riad El Solh Street • Saida")
    assert.equal(detailed, "Riad El Solh Street • Saida")
    console.log(caseResult("6 Saida", parsed.street, concise, detailed))
  })

  it("7. Tyre street / Tyre", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        road: "Allenby Street",
        city: "Tyre",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "Allenby Street")
    assert.equal(concise, "Allenby Street • Tyre")
    assert.equal(detailed, "Allenby Street • Tyre")
    console.log(caseResult("7 Tyre", parsed.street, concise, detailed))
  })

  it("8. Zahle street / Zahle", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        road: "Boulevard Street",
        city: "Zahle",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "Boulevard Street")
    assert.equal(concise, "Boulevard Street • Zahle")
    assert.equal(detailed, "Boulevard Street • Zahle")
    console.log(caseResult("8 Zahle", parsed.street, concise, detailed))
  })

  it("9. mountain village without street", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        village: "Baskinta",
        county: "Matn",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "")
    assert.equal(concise, "Baskinta • Matn")
    assert.equal(detailed, "Baskinta • Matn")
    console.log(caseResult("9 Baskinta/Matn", parsed.street, concise, detailed))
  })

  it("10. highway reference only", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        highway: "autoroute du nord",
        city: "Jbeil",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "autoroute du nord")
    assert.ok(concise.startsWith("autoroute du nord"))
    assert.ok(detailed.includes("autoroute du nord"))
    console.log(caseResult("10 highway", parsed.street, concise, detailed))
  })

  it("11. generic Unnamed Road rejected", () => {
    const street = extractStreetFromNominatimAddress({
      road: "Unnamed Road",
      neighbourhood: "Hamra",
      city: "Beirut",
    })
    const parsed = parseNominatimToLocationInfo({
      address: {
        road: "Unnamed Road",
        neighbourhood: "Hamra",
        city: "Beirut",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(street, "")
    assert.equal(parsed.street, "")
    assert.equal(concise, "Hamra • Beirut")
    assert.equal(detailed, "Hamra • Beirut")
    console.log(caseResult("11 Unnamed Road", parsed.street, concise, detailed))
  })

  it("12. duplicate area/city collapsed once", () => {
    const concise = formatLebaneseLocationConcise({
      street: "Main Street",
      area: "Beirut",
      city: "Beirut",
    })
    const detailed = formatLebaneseLocationDetailed({
      street: "Main Street",
      area: "Beirut",
      city: "Beirut",
    })
    assert.equal(concise, "Main Street • Beirut")
    assert.equal(detailed, "Main Street • Beirut")
    console.log(caseResult("12 duplicate area/city", "Main Street", concise, detailed))
  })

  it("13. Arabic-only response", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        road: "شارع بلس",
        neighbourhood: "الحمرا",
        city: "بيروت",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed({
      locationName: "قرب الجامعة الأميركية",
      street: parsed.street,
      area: parsed.area,
      city: parsed.city,
    })
    assert.equal(parsed.street, "شارع بلس")
    assert.equal(concise, "شارع بلس • الحمرا • بيروت")
    assert.equal(
      detailed,
      "قرب الجامعة الأميركية • شارع بلس • الحمرا • بيروت"
    )
    console.log(caseResult("13 Arabic", parsed.street, concise, detailed))
  })

  it("14. English-only response", () => {
    const parsed = parseNominatimToLocationInfo({
      address: {
        road: "Hamra Street",
        suburb: "Hamra",
        city: "Beirut",
        county: "Beirut Governorate",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "Hamra Street")
    assert.equal(concise, "Hamra Street • Hamra • Beirut")
    assert.ok(detailed.includes("Hamra Street"))
    assert.ok(detailed.includes("Beirut Governorate"))
    console.log(caseResult("14 English", parsed.street, concise, detailed))
  })

  it("15. mixed Arabic/English response", () => {
    const parsed = parseNominatimToLocationInfo({
      name: "ABC Achrafieh",
      address: {
        road: "Alfred Naccache Street",
        neighbourhood: "الأشرفية",
        city: "Beirut",
      },
    })
    const concise = formatLebaneseLocationConcise(parsed)
    const detailed = formatLebaneseLocationDetailed(parsed)
    assert.equal(parsed.street, "Alfred Naccache Street")
    assert.equal(parsed.locationName, "ABC Achrafieh")
    assert.equal(concise, "Alfred Naccache Street • الأشرفية • Beirut")
    assert.equal(
      detailed,
      "ABC Achrafieh • Alfred Naccache Street • الأشرفية • Beirut"
    )
    console.log(caseResult("15 mixed", parsed.street, concise, detailed))
  })

  it("residential preferred after road/pedestrian; generic Arabic unnamed rejected", () => {
    assert.equal(
      extractStreetFromNominatimAddress({
        residential: "Rue Pasteur",
        neighbourhood: "Hamra",
      }),
      "Rue Pasteur"
    )
    assert.equal(
      extractStreetFromNominatimAddress({
        road: "طريق بدون اسم",
        pedestrian: "شارع الجميزة",
      }),
      "شارع الجميزة"
    )
    assert.equal(
      extractStreetFromNominatimAddress({ road: "33.89, 35.50" }),
      ""
    )
  })
})
