import { defineNuxtConfig } from "nuxt/config";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2024-04-03",
  devtools: { enabled: false },
  ssr: false,
  app: {
    head: {
      viewport:
        "width=device-width, initial-scale=1.0, interactive-widget=resizes-content",
    },
  },
  modules: [
    "nuxt-vuefire",
    "@nuxt/ui",
    "@vueuse/nuxt",
    [
      "@pinia/nuxt",
      {
        autoImports: ["defineStore", "acceptHMRUpdate"],
      },
    ],
    "motion-v/nuxt",
    "@nuxt/test-utils/module",
  ],
  css: ["~/assets/css/main.css"],
  ui: {
    colorMode: true,
  },
  imports: {
    dirs: ["~/stores"],
  },
  nitro: {
    prerender: {
      // these routes are not dependent on any data and can be prerendered
      // it's a good idea to pre render all routes that you can
      routes: [],
    },
  },
  vuefire: {
    emulators: {
      enabled: true,
    },
    auth: {
      enabled: true,
      sessionCookie: true,
      options: {
        disableWarnings: true,
      },
      host: "0.0.0.0",
    },

    firestore: { host: "0.0.0.0", port: 8081 },
    storage: { host: "0.0.0.0", port: 9199 },

    config: {
      apiKey: "AIzaSyDGoiU6oNsWu552g_uSU9N-Gqcf9m27VkU",
      authDomain: "pressit-today.firebaseapp.com",
      projectId: "pressit-today",
      storageBucket: "pressit-today.firebasestorage.app",
      messagingSenderId: "1081277700696",
      appId: "1:1081277700696:web:e37034a1e76f7929e0482d",
      measurementId: "G-2GX3MLCZXM",
    },
  },

  vite: {
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
          verbatimModuleSyntax: false,
          useDefineForClassFields: false,
        },
      },
    },
  },
});
