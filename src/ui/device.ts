/** Phone / tablet detection and helpers shared by the UI. */

/** true on phones / tablets (touch-first screens); force with ?touch=1 */
export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (new URLSearchParams(location.search).has('touch') || window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0);

export const TOUCH = isTouchDevice();

/** Rewrite keyboard hints ("Press F", "Hold SHIFT"...) into the on-screen button names for touch players. */
const RULES: [RegExp, string][] = [
  [/Press M for the map, TAB to pause\. F enters vehicles\./, 'Tap MAP for the map. Tap CAR next to a vehicle to get in.'],
  [/W\/S accelerate and brake, A\/D steer, SPACE for the handbrake\./, 'Push the stick up to drive, down to brake, sideways to steer. DRIFT is the handbrake.'],
  [/In the air: .*$/, 'In the air: stick to turn and slow down, ▲ UP to climb, ▼ DOWN to dive. Land gently on a road or the runway!'],
  [/hold W \/ ↑ to speed up/, 'push the stick up to speed up'],
  [/Hold SPACE \(handbrake\)/, 'Hold DRIFT'],
  [/Use SPACE to drift/, 'Use DRIFT'],
  [/SPACE to jump/, 'JUMP to jump'],
  [/Hold SHIFT to sprint/, 'Push the stick all the way up to sprint'],
  [/Hold SHIFT for nitro/, 'Hold NITRO for a boost'],
  [/[Pp]ress T to (start|end) (a taxi|your) shift/, 'Tap TAXI to $1 $2 shift'],
  [/[Pp]ress F near/, 'Tap CAR near'],
  [/[Pp]ress E at/, 'Tap USE at'],
  [/with E\b/, 'with USE'],
  [/[Pp]ress H to heal/, 'Tap MED to heal'],
  [/\(press \d\)/, '(tap GUN to switch)'],
  [/ \((Esc|Enter|H)\)$/, ''],
];

export function tt(s: string): string;
export function tt(s: string | null | undefined): string | null | undefined;
export function tt(s: string | null | undefined) {
  if (!TOUCH || !s) return s;
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  return s;
}

/** Go fullscreen and lock to landscape where the browser allows it (Android Chrome; iOS ignores it). */
export function goFullscreen() {
  if (!TOUCH) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (!document.fullscreenElement) {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
      Promise.resolve(p)
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
        .catch(() => {});
    }
  } catch {
    /* not supported */
  }
}

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else goFullscreen();
}
