/**
 * Type definitions for the Lottie render service.
 */

/**
 * Render configuration options.
 */
export interface RenderOptions {
  width?: number;          // Video width (default: the Lottie JSON's own width, else 1920)
  height?: number;         // Video height (default: the Lottie JSON's own height, else 1080)
  fps?: number;           // Frame rate (default: the Lottie JSON's own frame rate, else 30)
  backgroundColor?: string;  // Background color (default transparent)
  quality?: number;       // JPEG quality 0-100 used for intermediate frame capture (default 80)
  outputPath?: string;    // Write the final MP4 here instead of a temp file; the caller owns cleanup
  maxFrames?: number;     // Reject animations requesting more frames than this (default 6000)
  maxDimension?: number;  // Reject a resolved width/height larger than this, in px (default 4096)
  headless?: boolean;     // Run the capture browser headless (default true)
}

/**
 * Animation metadata. `extractMetadata()` returns this describing the
 * source Lottie JSON as authored; `RenderResult.metadata` returns this
 * describing what was actually rendered (reflecting any `RenderOptions`
 * overrides), which may differ from the source.
 */
export interface LottieMetadata {
  duration: number;      // Duration (seconds)
  fps: number;          // Frame rate
  width: number;        // Width
  height: number;       // Height
  name?: string;        // Animation name
}

/**
 * Render result. `videoPath` and `videoBuffer` are mutually exclusive: a
 * path is returned when `RenderOptions.outputPath` was given (the caller
 * owns that file), otherwise the video is returned in-memory as a Buffer.
 */
export interface RenderResult {
  success: boolean;
  videoPath?: string;
  videoBuffer?: Buffer;
  error?: string;
  duration: number;     // Render time (ms)
  metadata?: LottieMetadata;
}

/**
 * Base Lottie JSON structure.
 */
export interface LottieJSON {
  v: string;           // Lottie version
  fr: number;          // Frame rate
  ip: number;          // In point (start frame)
  op: number;          // Out point (end frame)
  w: number;           // Width
  h: number;           // Height
  nm?: string;         // Name
  assets?: any[];      // Assets
  layers?: any[];      // Layers
  [key: string]: any;  // Other properties
}
