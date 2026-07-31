/**
 * Returns true when the user's keyboard focus is somewhere inside the right
 * panel — the tab bar, a file editor or diff, the preview chrome, or (via
 * Electron `<webview>` focus events) an embedded page. The shell wraps every
 * panel surface, so `previewFocus` reads as "the right panel owns focus".
 *
 * Used by the global keybinding handler to gate `preview.refresh`,
 * `preview.focusUrl`, and `rightPanel.closeTab` on the panel owning focus.
 */
export function isPreviewFocused(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (!activeElement.isConnected) return false;
  if (activeElement.tagName.toLowerCase() === "webview") return true;
  return activeElement.closest("[data-preview-panel-mode]") !== null;
}
