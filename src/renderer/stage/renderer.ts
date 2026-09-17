import * as THREE from 'three'
import { RENDER_RATES } from '@shared/constants'
import { TIME_OF_DAY_RIGS, type TimeOfDay } from '@shared/palette'

/**
 * The stage renderer (§5.2, §5.3): orthographic, 1 world unit = 1 DIP px, so
 * screen-space maths is an exact linear map — hit-testing, walking, clamping
 * and laser lens coordinates all fall out of that (§5.3).
 *
 * Rendering is on demand: the rAF loop skips frames to hit the phase's fps cap
 * (§5.7) and stops entirely when the window is hidden.
 */
export class StageRenderer {
  readonly scene = new THREE.Scene()
  readonly camera: THREE.OrthographicCamera
  readonly renderer: THREE.WebGLRenderer
  private readonly hemi: THREE.HemisphereLight
  private readonly sun: THREE.DirectionalLight
  private width = 1
  private height = 1
  private fpsCap: number = RENDER_RATES.idleKeepAliveFps
  private lastRender = 0
  private shakeUntil = 0
  private shakeAmount = 0
  private timeOfDay: TimeOfDay = 'day'

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'low-power'
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -200, 200)
    this.camera.position.set(0, 0, 50)

    this.hemi = new THREE.HemisphereLight(0xfff8ec, 0xd8c9b0, 0.9)
    this.sun = new THREE.DirectionalLight(0xfff6e0, 0.6)
    this.sun.position.set(-0.45, 0.75, 0.6)
    this.scene.add(this.hemi, this.sun)
  }

  resize(width: number, height: number, devicePixelRatio = window.devicePixelRatio): void {
    this.width = Math.max(1, Math.round(width))
    this.height = Math.max(1, Math.round(height))
    this.camera.left = 0
    this.camera.right = this.width
    this.camera.top = this.height
    this.camera.bottom = 0
    this.camera.updateProjectionMatrix()
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setSize(this.width, this.height, false)
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height }
  }

  /** Time-of-day light rig: palette swap on lights only, no material changes. */
  setTimeOfDay(rig: TimeOfDay): void {
    if (rig === this.timeOfDay) return
    this.timeOfDay = rig
    const config = TIME_OF_DAY_RIGS[rig]
    this.hemi.color.set(config.hemiSky)
    this.hemi.groundColor.set(config.hemiGround)
    this.hemi.intensity = config.hemiIntensity
    this.sun.color.set(config.dirColor)
    this.sun.intensity = config.dirIntensity
  }

  get currentTimeOfDay(): TimeOfDay {
    return this.timeOfDay
  }

  /** Screen shake for tier 3 blasts: the camera moves, never the OS window. */
  shake(amountPx: number, ms: number): void {
    this.shakeAmount = amountPx
    this.shakeUntil = performance.now() + ms
  }

  setFpsCap(fps: number): void {
    this.fpsCap = Math.max(1, fps)
  }

  /** Window DIP (y down) -> world units (y up). */
  screenToWorld(x: number, y: number, z = 0): THREE.Vector3 {
    return new THREE.Vector3(x, this.height - y, z)
  }

  worldToScreen(position: THREE.Vector3): { x: number; y: number } {
    return { x: position.x, y: this.height - position.y }
  }

  /** @returns true when a frame was actually drawn. */
  render(now: number, force = false): boolean {
    const interval = 1000 / this.fpsCap
    if (!force && now - this.lastRender < interval) return false
    this.lastRender = now

    if (now < this.shakeUntil) {
      const t = now / 1000
      this.camera.position.x = Math.sin(t * Math.PI * 8) * this.shakeAmount
      this.camera.position.y = Math.cos(t * Math.PI * 8) * this.shakeAmount * 0.6
    } else if (this.camera.position.x !== 0 || this.camera.position.y !== 0) {
      this.camera.position.x = 0
      this.camera.position.y = 0
    }

    this.renderer.render(this.scene, this.camera)
    return true
  }

  dispose(): void {
    this.renderer.dispose()
  }
}
