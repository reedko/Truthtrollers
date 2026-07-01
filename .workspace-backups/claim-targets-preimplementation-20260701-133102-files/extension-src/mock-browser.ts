// Mock browser extension API for sandbox/demo environment
const mockBrowser = {
  runtime: {
    sendMessage: (message: any) => {
      console.log('[Mock Browser] sendMessage:', message);
      // Return a tiny 1x1 transparent PNG as base64
      const tinyPNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      return Promise.resolve({ ok: true, base64: tinyPNG, type: 'image/png' });
    },
    getURL: (path: string) => {
      console.log('[Mock Browser] getURL:', path);
      return path;
    },
  },
  storage: {
    local: {
      get: (keys?: string | string[] | Record<string, any>) => {
        console.log('[Mock Browser] storage.local.get:', keys);
        return Promise.resolve({});
      },
      set: (items: Record<string, any>) => {
        console.log('[Mock Browser] storage.local.set:', items);
        return Promise.resolve();
      },
    },
  },
};

export default mockBrowser;
export { mockBrowser as browser };
