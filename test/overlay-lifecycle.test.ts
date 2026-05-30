import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { overlayCloseScrollState } from "../src/tui/overlayLifecycle.js";
import { useNativeTrackpadScroll } from "../src/tui/transcript.js";

describe("overlay lifecycle", () => {
  it("preserves scroll offset when overlay closes", () => {
    assert.deepEqual(overlayCloseScrollState(12), {
      scrollLineOffset: 12,
      holdNativeScroll: false,
      scrollMode: false,
    });
    assert.deepEqual(overlayCloseScrollState(0), {
      scrollLineOffset: 0,
      holdNativeScroll: false,
      scrollMode: false,
    });
  });

  it("blocks native scroll only while overlay is open", () => {
    assert.equal(
      useNativeTrackpadScroll({ altScreen: false, scrollLineOffset: 0, scrollMode: false, overlay: true }),
      false
    );
    const afterClose = overlayCloseScrollState(0);
    assert.equal(
      useNativeTrackpadScroll({
        altScreen: false,
        scrollLineOffset: afterClose.scrollLineOffset,
        scrollMode: afterClose.scrollMode,
        holdNativeScroll: afterClose.holdNativeScroll,
      }),
      true
    );
  });

  it("keeps keyboard scroll virtual after overlay close when offset > 0", () => {
    const afterClose = overlayCloseScrollState(5);
    assert.equal(
      useNativeTrackpadScroll({
        altScreen: false,
        scrollLineOffset: afterClose.scrollLineOffset,
        scrollMode: afterClose.scrollMode,
        holdNativeScroll: afterClose.holdNativeScroll,
      }),
      false
    );
  });
});
