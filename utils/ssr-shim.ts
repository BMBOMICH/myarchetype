if (typeof window === 'undefined') {
  const noop = () => {};
  const createEl = (tag: string) => ({
    tagName: tag.toUpperCase(),
    style: {},
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    removeChild: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getContext: () => null,
    toDataURL: () => '',
    play: () => Promise.resolve(),
    pause: noop,
    set src(_: string) {},
    set crossOrigin(_: string) {},
    set muted(_: boolean) {},
    set onload(_: any) {},
    set onerror(_: any) {},
    set onloadedmetadata(_: any) {},
    get videoWidth() { return 0; },
    get videoHeight() { return 0; },
  });

  const win = {
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop }),
    location: { hostname: 'localhost', href: '', pathname: '', search: '', hash: '' },
    confirm: () => true,
    alert: noop,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    scrollTo: noop,
    innerWidth: 0,
    innerHeight: 0,
    devicePixelRatio: 1,
    navigator: {
      userAgent: 'node',
      language: 'en-US',
      hardwareConcurrency: 1,
      platform: 'node',
      mediaDevices: { getUserMedia: () => Promise.reject(new Error('No camera')), enumerateDevices: () => Promise.resolve([]) },
    },
  };

  const doc = {
    createElement: createEl,
    createElementNS: (_ns: string, tag: string) => createEl(tag),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    head: { appendChild: noop, removeChild: noop },
    body: { appendChild: noop, removeChild: noop },
    documentElement: { lang: 'en', dir: 'ltr', style: {}, setAttribute: noop, getAttribute: () => null },
    title: '',
    addEventListener: noop,
    removeEventListener: noop,
  };

  try { (globalThis as any).window = win; } catch { Object.defineProperty(globalThis, 'window', { value: win, writable: true, configurable: true }); }
  try { (globalThis as any).document = doc; } catch { Object.defineProperty(globalThis, 'document', { value: doc, writable: true, configurable: true }); }
  // Do NOT touch globalThis.navigator — it is read-only in this environment
}
export {};