// amd per 1 unit, used until the live fetch lands (or forever, if it never does)
export const DEFAULT_AMD_PER = {
  '051': 1,
  '840': 371,
  '978': 422,
};

const FETCH_URL = 'https://open.er-api.com/v6/latest/AMD';

export function createRates({ overrides = {}, live = true, ttlMs = 6 * 60 * 60 * 1000, log = console } = {}) {
  const table = { ...DEFAULT_AMD_PER, ...overrides };
  let source = Object.keys(overrides).length ? 'config' : 'defaults';
  let lastFetch = 0;

  async function refresh() {
    if (!live) return;
    try {
      const r = await fetch(FETCH_URL, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j && j.result === 'success' && j.rates) {
        // the feed is quoted per 1 AMD, we want it the other way round
        for (const [code, iso] of [['840', 'USD'], ['978', 'EUR']]) {
          const per = j.rates[iso];
          if (per && per > 0 && overrides[code] == null) table[code] = 1 / per;
        }
        source = 'live';
        lastFetch = Date.now();
        log.log?.(`rates updated (live): 1 USD=${table['840'].toFixed(2)} AMD, 1 EUR=${table['978'].toFixed(2)} AMD`);
      }
    } catch (e) {
      log.error?.('live rate fetch failed, keeping fallback:', e.message);
    }
  }

  return {
    amdPerUnit(code) { return table[code] ?? 1; },
    toAMD(amount, code) {
      const n = Number(amount);
      if (code === '051') return Math.round(n);
      return Math.round(n * (table[code] ?? 1));
    },
    table: () => ({ ...table }),
    source: () => source,
    refresh,
    maybeRefresh() { if (live && Date.now() - lastFetch > ttlMs) return refresh(); },
  };
}
