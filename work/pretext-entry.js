import * as Pretext from '@chenglou/pretext';

if (typeof window !== 'undefined') {
  window.Pretext = Pretext;
}
if (typeof globalThis !== 'undefined') {
  globalThis.Pretext = Pretext;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Pretext;
}

export default Pretext;
export * from '@chenglou/pretext';
