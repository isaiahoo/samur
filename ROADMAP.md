# Kunak Platform — Roadmap

## Next Steps (prioritized)

### 1. Dynamic Scenario Awareness
Connect real-time river data to the static damage scenarios. Show a **"current trajectory" indicator** inside the DamageScenario card — e.g., "Текущий расход: 340 м³/с — 12% от порога умеренного паводка". When discharge crosses a scenario threshold percentage (say 50%), auto-highlight that tab.

**Files:** `DamageScenario.tsx`, `floodScenarios.ts` (add `peakDischargeM3s` comparison logic)
**Data needed:** Current `dischargeCubicM` from `RiverLevel` (already available as prop)

### 2. One-Click EventPanel → Detail Panel
Currently clicking a river in the EventPanel flies to the marker but doesn't open the detail sheet — user must click the marker again. Make it one action: fly + highlight + open detail panel automatically.

**Files:** `MapPage.tsx` (`handleEventPanelClick`), `EventPanel.tsx`
**Approach:** Call `openSheet(<DetailPanel .../>)` inside `handleEventPanelClick` alongside `flyTo` and `highlightMarker`

### 3. Evacuation & Emergency Info Per Scenario
Add emergency contacts, evacuation directions, and nearest shelter cross-references for each damage scenario. The shelter data already exists in the system — cross-reference shelter locations with `keySettlements` at risk.

**Files:** `floodScenarios.ts` (add `evacuationInfo` field), `DamageScenario.tsx` (render section), `MapPage.tsx` (pass shelters data)
**Data needed:** Shelter coordinates + capacity (already fetched in MapPage)

### 4. Composite Flood Risk Index
The system independently tracks precipitation forecast, soil moisture, snow melt, and river levels. Combine all four into a **single composite risk score** per region:
- Heavy rain + saturated soil + active snowmelt + rising river = maximum risk
- Display as an overlay or as a summary badge per river

**Files:** New `compositeRisk.ts` utility, integrate into `RiverLevelDetail.tsx` and potentially `EventPanel.tsx`
**Data needed:** All four data sources already available in `MapPage.tsx`

### 5. Historical Comparison on GaugeChart
Add reference lines on the 7-day GaugeChart showing "discharge on this date during major floods" (2002, 2010, 2021). Gives immediate visual context — is the river tracking toward a historical event?

**Files:** `GaugeChart.tsx` (add reference lines), API endpoint for historical same-date data
**Data needed:** Historical discharge records from DB (query by day-of-year across past years)

---

## Completed Features

- Flood damage scenarios with 38 scenarios across 14 river systems (audited)
- EventPanel with fly-to and marker highlight
- Precipitation overlay with IDW interpolation and weather-radar color ramp
- Dark mode Frutiger-style detail panels
- Upstream danger early warning system
- Soil moisture correlation in river detail
- Forecast warning (7-day discharge/level prediction)
