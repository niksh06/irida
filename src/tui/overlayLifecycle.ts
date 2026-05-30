/**
 * Pure overlay scroll policy (shared by App and tests).
 * Closing an overlay preserves keyboard scroll offset and restores trackpad at bottom.
 */
export function overlayCloseScrollState(scrollLineOffset: number): {
  scrollLineOffset: number;
  holdNativeScroll: boolean;
  scrollMode: boolean;
} {
  return {
    scrollLineOffset,
    holdNativeScroll: false,
    scrollMode: false,
  };
}
