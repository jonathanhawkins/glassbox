// Remotion root for CLI rendering (the in-app preview uses <Player> directly and
// does not need this). Render the promotional mp4 with:
//
//   cd apps/web
//   npx remotion render src/remotion/index.ts MarketingVideo out/glassbox-marketing.mp4
//
import React from "react";
import { Composition } from "remotion";

import { MarketingVideo } from "./MarketingVideo";
import { VIDEO } from "./theme";

export function RemotionRoot() {
  return (
    <Composition
      id="MarketingVideo"
      component={MarketingVideo}
      durationInFrames={VIDEO.durationInFrames}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
}
