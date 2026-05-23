// the merchant account is amd-only, so usd/eur are converted before charging
export const DEFAULT_AMD_PER = {
  '051': 1,
  '840': 371,
  '978': 422,
};

export function createRates({ overrides = {} } = {}) {
  const table = { ...DEFAULT_AMD_PER, ...overrides };
  const source = Object.keys(overrides).length ? 'config' : 'defaults';
  return {
    amdPerUnit(code) { return table[code] ?? 1; },
    toAMD(amount, code) {
      const n = Number(amount);
      if (code === '051') return Math.round(n);
      return Math.round(n * (table[code] ?? 1));
    },
    table: () => ({ ...table }),
    source: () => source,
    async refresh() {},
    maybeRefresh() {},
  };
}
