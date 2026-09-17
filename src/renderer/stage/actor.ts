import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CROSSFADE, SIZES } from '@shared/constants'
import { PALETTE } from '@shared/palette'
import { buildOutlines, contactShadow, setOutlineWidth, toonify } from './toon'

/**
 * The Buddha: model, mixer, outlines, lens markers, contact shadow.
 *
 * Clip playback is completely event-driven — this class is told *which* clip to
 * play and never decides anything (§5.4).
 */
export class BodhiActor {
  readonly group = new THREE.Group()
  private model: THREE.Object3D | null = null
  private mixer: THREE.AnimationMixer | null = null
  private readonly actions = new Map<string, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private lensLeft: THREE.Object3D | null = null
  private lensRight: THREE.Object3D | null = null
  private lensMaterial: THREE.MeshToonMaterial | null = null
  private hulls: THREE.Mesh[] = []
  private shadow: THREE.Mesh | null = null
  private height: number = SIZES.petHeight
  private charge = false
  private readonly bounds = new THREE.Box3()

  get isLoaded(): boolean {
    return this.model != null
  }

  async load(bytes: ArrayBuffer, gradientMap: THREE.DataTexture): Promise<void> {
    const loader = new GLTFLoader()
    const gltf = await loader.parseAsync(bytes, '')
    this.model = gltf.scene
    this.model.name = 'bodhi'

    toonify(this.model, gradientMap)
    this.hulls = buildOutlines(this.model, {
      widthPx: 1.8,
      worldScale: this.height,
      filter: (name) => name.startsWith('bodhi_')
    })
    setOutlineWidth(this.hulls, 1.8, this.height)

    this.lensLeft = this.model.getObjectByName('lens_l') ?? null
    this.lensRight = this.model.getObjectByName('lens_r') ?? null
    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh && mesh.name.includes(':lensVC')) {
        this.lensMaterial = mesh.material as THREE.MeshToonMaterial
      }
    })

    this.mixer = new THREE.AnimationMixer(this.model)
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip)
      action.setLoop(loopFor(clip.name), Infinity)
      action.clampWhenFinished = true
      this.actions.set(clip.name, action)
    }

    this.group.add(this.model)
    this.group.scale.setScalar(this.height)
    this.group.name = 'bodhi-actor'

    this.shadow = contactShadow(this.height * 0.22)
    this.shadow.visible = false
    this.group.add(this.shadow)

    // Start on the idle seated pose so the first frame is never a T-pose.
    this.play('idle_sit', 0)
    this.model.updateMatrixWorld(true)
    this.recalculateBounds()
  }

  /** Rendered height in DIP px (§5.3): 110 px at 100%. */
  setHeight(px: number): void {
    this.height = px
    this.group.scale.setScalar(px)
    if (this.hulls.length > 0) setOutlineWidth(this.hulls, 1.8, px)
    if (this.shadow) {
      this.shadow.scale.setScalar(px / SIZES.petHeight)
    }
    this.recalculateBounds()
  }

  /** Which way he faces: 0 = front (camera), ±1 = walking left/right. */
  setFacing(direction: -1 | 0 | 1): void {
    const target = direction === 0 ? 0 : direction * THREE.MathUtils.degToRad(62)
    this.group.rotation.y = target
  }

  play(clip: string, crossfade: number = CROSSFADE.default): void {
    if (!this.mixer) return
    const action = this.actions.get(clip)
    if (!action) {
      console.warn(`[bodhi] unknown clip "${clip}"`)
      return
    }
    if (clip !== 'shades_charge') this.setCharge(false)

    if (this.current === action) {
      if (!action.isRunning()) action.reset().play()
      return
    }

    action.reset()
    action.enabled = true
    action.setEffectiveWeight(1)
    action.play()

    if (this.current && this.current !== action) {
      // Never snap: every transition crossfades (§3.5, §5.4).
      this.current.crossFadeTo(action, Math.max(CROSSFADE.min, crossfade), false)
    }
    this.current = action
  }

  update(dt: number): void {
    this.mixer?.update(dt)
  }

  /** Lens emissive for the laser charge beat (§4.3 shades_charge). */
  setCharge(on: boolean): void {
    if (this.charge === on) return
    this.charge = on
    if (!this.lensMaterial) return
    if (on) {
      this.lensMaterial.vertexColors = false
      this.lensMaterial.color.set(PALETTE.laserCore)
      this.lensMaterial.emissive = new THREE.Color(PALETTE.laserCore)
      this.lensMaterial.emissiveIntensity = 1
    } else {
      this.lensMaterial.vertexColors = true
      this.lensMaterial.color.set(0xffffff)
      this.lensMaterial.emissive = new THREE.Color(0x000000)
      this.lensMaterial.emissiveIntensity = 0
    }
    this.lensMaterial.needsUpdate = true
  }

  /** Fallback shades mode: frosted lenses for the whole focus phase (§3.4). */
  setFrost(on: boolean): void {
    if (!this.lensMaterial) return
    if (on) {
      this.lensMaterial.vertexColors = false
      this.lensMaterial.color.set('#F4F1E8')
    } else {
      this.lensMaterial.vertexColors = true
      this.lensMaterial.color.set(0xffffff)
    }
    this.lensMaterial.needsUpdate = true
  }

  setShadowVisible(visible: boolean): void {
    if (this.shadow) this.shadow.visible = visible
  }

  /** Lens positions in window DIP, for the laser overlay (§6.6). */
  lensPositions(screenHeight: number): { left: THREE.Vector2; right: THREE.Vector2 } | null {
    if (!this.lensLeft || !this.lensRight) return null
    const left = new THREE.Vector3()
    const right = new THREE.Vector3()
    this.lensLeft.getWorldPosition(left)
    this.lensRight.getWorldPosition(right)
    return {
      left: new THREE.Vector2(left.x, screenHeight - left.y),
      right: new THREE.Vector2(right.x, screenHeight - right.y)
    }
  }

  /** World-space AABB, used for the cheap first pass of the hit test (§5.5). */
  get worldBounds(): THREE.Box3 {
    this.bounds.setFromObject(this.group)
    return this.bounds
  }

  private recalculateBounds(): void {
    if (!this.model) return
    this.model.updateMatrixWorld(true)
    this.bounds.setFromObject(this.group)
  }

  dispose(): void {
    this.mixer?.stopAllAction()
    this.hulls.forEach((hull) => (hull.material as THREE.Material).dispose())
    this.model?.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.isMesh) mesh.geometry.dispose()
    })
  }
}

/** Which of our clips loop, and which hold their last frame (§4.3). */
function loopFor(name: string): THREE.AnimationActionLoopStyles {
  const looping = new Set(['idle_sit', 'meditate', 'walk', 'walk_left'])
  return looping.has(name) ? THREE.LoopRepeat : THREE.LoopOnce
}
