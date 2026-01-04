// Mock color-mode helper to prevent errors in test environment
// The color-mode plugin looks for window[globalName] where globalName defaults to "__NUXT_COLOR_MODE__"
if (typeof window !== "undefined") {
  const colorModeHelper = {
    preference: "light",
    value: "light",
    getColorScheme: () => "light",
    addColorScheme: () => {},
    removeColorScheme: () => {},
  };

  // Set the helper on the global name that the plugin expects
  (window as any).__NUXT_COLOR_MODE__ = colorModeHelper;
}
