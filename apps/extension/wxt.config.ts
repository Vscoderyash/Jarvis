import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: {
    name: 'JARVIS Browser Agent',
    description: 'JARVIS by Yash Raj: plans, thinks and acts on web pages by voice. Pairs with JARVIS Desktop for the whole computer.',
    minimum_chrome_version: '116',
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    permissions: ['storage', 'tabs', 'scripting', 'sessions', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    side_panel: { default_path: 'sidepanel.html' },
    action: {
      default_title: 'JARVIS',
      default_icon: {
        16: '/icons/16.png',
        48: '/icons/48.png',
        128: '/icons/128.png',
      },
    },
    icons: {
      16: '/icons/16.png',
      48: '/icons/48.png',
      128: '/icons/128.png',
    },
  },
});
