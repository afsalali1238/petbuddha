/**
 * The DOM overlay: break countdown, hover hint, break nudge sign, and the
 * laser "return to the path" pill.
 *
 * Text is DOM rather than 3D — crisper at 11 px, no font atlas, and it costs
 * nothing on the GPU (§4.5: the nudge sign is plain text, no dashboard).
 */
export class Hud {
  private readonly countdown: HTMLElement
  private readonly nudge: HTMLElement
  private readonly hint: HTMLElement
  private readonly pill: HTMLElement
  private pillTimer: number | null = null

  constructor(root: HTMLElement) {
    this.countdown = root.querySelector('#countdown') as HTMLElement
    this.nudge = root.querySelector('#nudge') as HTMLElement
    this.hint = root.querySelector('#hint') as HTMLElement
    this.pill = root.querySelector('#pill') as HTMLElement
  }

  private place(element: HTMLElement, x: number, y: number): void {
    element.style.left = `${Math.round(x)}px`
    element.style.top = `${Math.round(y)}px`
  }

  private show(element: HTMLElement, text: string, x: number, y: number): void {
    element.textContent = text
    this.place(element, x, y)
    element.classList.add('visible')
  }

  private hide(element: HTMLElement): void {
    element.classList.remove('visible')
  }

  setCountdown(text: string | null, x: number, y: number): void {
    if (text == null) this.hide(this.countdown)
    else this.show(this.countdown, text, x, y)
  }

  setNudge(text: string | null, x: number, y: number): void {
    if (text == null) this.hide(this.nudge)
    else this.show(this.nudge, text, x, y)
  }

  setHint(text: string | null, x: number, y: number): void {
    if (text == null) this.hide(this.hint)
    else this.show(this.hint, text, x, y)
  }

  /** Tier 3 blast: a small pill, never a modal, never focus-stealing (§6.5). */
  flashPill(text: string, x: number, y: number, ms = 3000): void {
    this.show(this.pill, text, x, y)
    if (this.pillTimer) window.clearTimeout(this.pillTimer)
    this.pillTimer = window.setTimeout(() => this.hide(this.pill), ms)
  }

  setPointer(on: boolean): void {
    document.body.classList.toggle('pointer', on)
  }
}
