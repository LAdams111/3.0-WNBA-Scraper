/**
 * Node 18 on Railway: undici (via cheerio deps) expects global `File`.
 * Node 20+ includes it; this minimal shim avoids ReferenceError at load time.
 */
if (typeof globalThis.File === 'undefined' && typeof Blob !== 'undefined') {
  globalThis.File = class File extends Blob {
    constructor(bits, name, options = {}) {
      super(bits, options);
      Object.defineProperty(this, 'name', {
        value: String(name),
        enumerable: true,
        writable: false,
      });
    }
  };
}
