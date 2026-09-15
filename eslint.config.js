// ESLint flat config: ловить undefined-ідентифікатори (той клас багів, що
// приховав 3D-піч: renderPhiGauge викликав невизначений clamp()).
// no-undef = error, тож `npm run lint` падає до пушу.
const BROWSER_GLOBALS = {
  window: 'readonly', document: 'readonly', location: 'readonly', navigator: 'readonly',
  history: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly', screen: 'readonly',
  console: 'readonly', open: 'readonly', self: 'readonly', globalThis: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  innerWidth: 'readonly', innerHeight: 'readonly', devicePixelRatio: 'readonly',
  addEventListener: 'readonly', removeEventListener: 'readonly', getComputedStyle: 'readonly',
  matchMedia: 'readonly', alert: 'readonly', prompt: 'readonly', confirm: 'readonly', fetch: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', FileReader: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', btoa: 'readonly', atob: 'readonly',
  structuredClone: 'readonly', Image: 'readonly', XMLHttpRequest: 'readonly', crypto: 'readonly',
  performance: 'readonly', ResizeObserver: 'readonly', MutationObserver: 'readonly',
  CustomEvent: 'readonly', Event: 'readonly', HTMLElement: 'readonly', Element: 'readonly',
  Node: 'readonly', FormData: 'readonly',
};
const NODE_GLOBALS = { console: 'readonly', process: 'readonly', URL: 'readonly', Blob: 'readonly' };

export default [
  { ignores: ['node_modules/**', '**/*.min.js'] },
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: BROWSER_GLOBALS },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-redeclare': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'no-unreachable': 'error',
    },
  },
  {
    files: ['tests/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...BROWSER_GLOBALS, ...NODE_GLOBALS } },
    rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none' }] },
  },
];
