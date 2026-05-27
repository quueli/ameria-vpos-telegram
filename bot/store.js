import fs from 'node:fs';
import path from 'node:path';

// json file keyed by our orderId, so a restart can resume tracking
export function createStore(dataDir) {
  const file = path.join(dataDir, 'payments.json');
  let data = {};

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    }
  } catch (e) {
    console.error('store init error:', e.message);
    data = {};
  }

  function persist() {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('store write error:', e.message);
    }
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
    active() {
      return Object.values(data).filter((p) => p.status === 'pending');
    },
    all() {
      return Object.values(data);
    },
  };
}
