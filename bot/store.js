import fs from 'node:fs';
import path from 'node:path';

export function createStore(dataDir) {
  const file = path.join(dataDir, 'payments.json');
  let data = {};

  fs.mkdirSync(dataDir, { recursive: true });
  if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));

  function persist() {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  return {
    get(id) {
      return data[id] || null;
    },
    set(id, value) {
      data[id] = { ...(data[id] || {}), ...value };
      persist();
      return data[id];
    },
    delete(id) {
      delete data[id];
      persist();
    },
    all() {
      return Object.values(data);
    },
  };
}
