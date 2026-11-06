/**
 * Landscape, whatever the browser does. A phone whose browser stays upright (rotation lock, some
 * in-app browsers such as WeChat's) gets the whole game turned 90° inside the page: held
 * sideways, the phone shows it the right way up. No "please rotate" wall.
 *
 * Everything lives in #stage. Its size is the game's ("stage") size: the screen's, or the
 * screen's turned on its side. Touch input arrives in screen coordinates; toStage() converts.
 *
 *   rotated: stage (x, y)  ->  screen (W - y, x)      W = the screen's width
 *            screen (cx, cy) -> stage (cy, W - cx)
 */
export const layout = {
  rotated: false,
  /** Stage size (CSS px). */
  w: window.innerWidth,
  h: window.innerHeight,
  /** The screen's width (for the conversion). */
  screenW: window.innerWidth,
};

export function toStage(cx: number, cy: number): [number, number] {
  return layout.rotated ? [cy, layout.screenW - cx] : [cx, cy];
}

/**
 * Size (and on an upright phone, turn) the stage to the window. Returns false when it left
 * things alone: while typing, an on-screen keyboard shrinks the window, and flipping the game
 * under the user's fingers then would be worse than a squashed frame.
 */
export function applyLayout(stage: HTMLElement, touchMode: boolean): boolean {
  const a = document.activeElement;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a !== document.body) return false;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rot = touchMode && H > W;
  layout.rotated = rot;
  layout.screenW = W;
  layout.w = rot ? H : W;
  layout.h = rot ? W : H;
  stage.style.width = `${layout.w}px`;
  stage.style.height = `${layout.h}px`;
  stage.style.transform = rot ? `translateX(${W}px) rotate(90deg)` : "";
  const root = document.documentElement.style;
  root.setProperty("--sw", `${layout.w}px`);
  root.setProperty("--sh", `${layout.h}px`);
  document.body.classList.toggle("rot", rot);
  document.body.classList.toggle("short", layout.h <= 540);
  return true;
}
