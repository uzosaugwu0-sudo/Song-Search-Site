// src/lib/sqlite-worker-init.js
if (typeof globalThis.location === 'undefined') {
  globalThis.location = { href: 'https://worker.local/' };
}

import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmModule from 'sql.js/dist/sql-wasm-browser.wasm';

let sqlPromise;

export function getSqlJs() {
  sqlPromise ??= initSqlJs({
    instantiateWasm(imports, successCallback) {
      WebAssembly.instantiate(wasmModule, imports).then((instance) => {
        successCallback(instance, wasmModule);
      });
      return {};
    },
  });
  return sqlPromise;
}
