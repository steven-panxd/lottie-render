/**
 * lottie-render — render Lottie animations to MP4 video, frame by frame.
 *
 * ```ts
 * import { renderLottie } from 'lottie-render';
 *
 * const result = await renderLottie(lottieJson, { width: 1080, height: 1080 });
 * if (result.success) {
 *   fs.writeFileSync('out.mp4', result.videoBuffer!);
 * }
 * ```
 *
 * An optional HTTP service built on top of this library lives under
 * `src/server/` — see the README for how to run it.
 */
export { renderLottie, extractMetadata } from './renderer/frame-by-frame';
export * from './types';
