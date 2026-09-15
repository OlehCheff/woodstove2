// Допоміжник: динамічно підвантажує Playwright, якщо він є.
export async function launchIfAvailable() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return null;
  }
  try {
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
    return { browser };
  } catch (e) {
    console.log('SMOKE SKIPPED — Playwright є, але браузер не запустився: ' + (e && e.message));
    return null;
  }
}
