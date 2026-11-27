// Чисті розрахунки Test Burn (без DOM): ККД з виміряного тепла і перевірка правдоподібності вводу.
import { EFF_MAX_PCT } from './physics-model.js';
import { TB_BURN_HOURS_MIN, TB_FUEL_POWER_RATIO_MAX, TB_MEASURED_POWER_RATIO } from './thresholds.js';

// predicted — результат PhysicsModel.evaluate(config); test — config.testBurn.
export function computeTestBurnCore(predicted, test) {
  const m = predicted.metrics;
  const auto = test.loadMode === 'auto';
  const loadKg = auto ? m.recommendedLoadKg : test.loadKg;
  const fuelEnergyKwh = loadKg * m.woodEnergyKwhKg;
  const hours = Math.max(test.measuredBurnHours, 0.1);
  const fuelInputPowerKw = fuelEnergyKwh / hours;
  const measuredHeatKwh = +test.measuredUsefulHeatKwh || 0;
  const hasMeasurement = measuredHeatKwh > 0;
  const measuredPower = hasMeasurement ? measuredHeatKwh / hours : 0;
  // НЕ обрізаємо до 100 %: інакше фізично неможливий ввід виглядає як «ККД 100 %».
  const measuredEfficiencyRawPct = hasMeasurement ? measuredHeatKwh / Math.max(fuelEnergyKwh, 0.1) * 100 : 0;
  const overUnity = hasMeasurement && measuredEfficiencyRawPct > 100;
  const measuredEfficiency = overUnity ? null : measuredEfficiencyRawPct;
  const errorPct = hasMeasurement ? ((measuredPower - m.heatOutputKw) / Math.max(m.heatOutputKw, 0.1)) * 100 : 0;
  return {
    predicted, test, loadKg, fuelEnergyKwh, fuelInputPowerKw, measuredHeatKwh, hasMeasurement, measuredPower,
    measuredEfficiency, measuredEfficiencyRawPct, overUnity, errorPct,
    fuelBasis: auto ? 'recommended' : 'manual',
  };
}

// Повертає [{ code, severity: 'error'|'warn'|'info', values, suspect? }]. 'error' = запис у журнал блокується;
// suspect = підозрілий вимір (запис потребує підтвердження й позначається в журналі).
export function checkTestBurnPlausibility(r) {
  const out = [];
  const { predicted, test } = r;
  if (r.hasMeasurement) {
    if (r.overUnity) out.push({ code: 'TB_OVER_UNITY', severity: 'error', values: { eff: r.measuredEfficiencyRawPct } });
    else if (r.measuredEfficiencyRawPct > EFF_MAX_PCT) out.push({ code: 'TB_EFF_HIGH', severity: 'warn', suspect: true, values: { eff: r.measuredEfficiencyRawPct, max: EFF_MAX_PCT } });
    if (r.fuelBasis === 'recommended') out.push({ code: 'TB_FUEL_AUTO', severity: 'info', values: { kg: r.loadKg } });
  }
  if (r.fuelBasis === 'manual' && r.loadKg > predicted.metrics.maxLoadKg) {
    out.push({ code: 'TB_LOAD_OVER_MAX', severity: 'warn', values: { kg: r.loadKg, max: predicted.metrics.maxLoadKg } });
  }
  const gross = predicted.metrics.grossHeatOutputKw;
  // Нереальний час: закладка не горить коротше за TB_BURN_HOURS_MIN (без вимірювання теж).
  if (test.measuredBurnHours < TB_BURN_HOURS_MIN) {
    out.push({ code: 'TB_HOURS_SHORT', severity: 'warn', suspect: r.hasMeasurement, values: { hours: test.measuredBurnHours, min: TB_BURN_HOURS_MIN } });
  }
  // Нереальна маса за годину: потужність палива в топці значно вища за модельну валову.
  if (gross > 0 && r.fuelInputPowerKw > gross * TB_FUEL_POWER_RATIO_MAX) {
    out.push({ code: 'TB_POWER_HIGH', severity: 'warn', suspect: r.hasMeasurement, values: { fuelKw: r.fuelInputPowerKw, grossKw: gross, ratio: r.fuelInputPowerKw / gross, kg: r.loadKg, hours: test.measuredBurnHours } });
  }
  // Виміряна потужність далека від модельної (>x у будь-який бік).
  const pred = predicted.metrics.heatOutputKw;
  if (r.hasMeasurement && pred > 0) {
    const ratio = r.measuredPower / pred;
    if (ratio > TB_MEASURED_POWER_RATIO || ratio < 1 / TB_MEASURED_POWER_RATIO) {
      out.push({ code: 'TB_POWER_FAR', severity: 'warn', suspect: true, values: { measuredKw: r.measuredPower, predictedKw: pred, ratio } });
    }
  }
  if (test.glassTempC > test.stoveTopTempC) {
    out.push({ code: 'TB_TEMP_ORDER', severity: 'warn', values: { glass: test.glassTempC, top: test.stoveTopTempC } });
  }
  return out;
}
