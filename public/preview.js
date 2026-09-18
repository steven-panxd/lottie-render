// The sandbox and CSP isolate uploaded animation data from the page and network.
let animation;
const notify = (type, values = {}) => parent.postMessage({ source: 'lottie-preview', type, ...values }, '*');
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.source !== 'lottie-demo') return;
  const { type, data, progress } = event.data;
  try {
    if (type === 'load') {
      animation?.destroy();
      animation = lottie.loadAnimation({ container: document.getElementById('animation'), renderer: 'svg', loop: false, autoplay: false, animationData: data });
      animation.addEventListener('DOMLoaded', () => notify('loaded'));
      animation.addEventListener('data_failed', () => notify('error'));
      animation.addEventListener('error', () => notify('error'));
      animation.addEventListener('enterFrame', () => notify('frame', { progress: animation.currentFrame / animation.totalFrames }));
      animation.addEventListener('complete', () => notify('paused'));
    } else if (type === 'play' && animation) {
      if (animation.currentFrame >= animation.totalFrames - 1) animation.goToAndStop(0, true);
      animation.play();
    } else if (type === 'pause') animation?.pause();
    else if (type === 'seek' && animation) animation.goToAndStop(Math.min(animation.totalFrames - 1, progress * animation.totalFrames), true);
  } catch { notify('error'); }
});
notify('ready');
