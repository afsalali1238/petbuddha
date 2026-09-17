import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BLOOM } from '@shared/constants'
import { easeOutBack } from '@shared/easing'
import { toonify } from './toon'

/**
 * The diorama: island, cushion, and the Bodhi tree with six individually
 * animated foliage clusters (§4.1, §4.5).
 *
 * Tree sway and the bloom "pop" are procedural — no clips needed.
 */
const SWAY_PERIOD_MS = 400
const SWAY_DEGREES = 1.5

interface Cluster {
  node: THREE.Object3D
  phase: number
  target: number
  current: number
  popping: number | null
}

export class Diorama {
  readonly group = new THREE.Group()
  private model: THREE.Object3D | null = null
  private clusters: Cluster[] = []
  private readonly seatLocal = new THREE.Vector3()
  private readonly canopyLocal = new THREE.Vector3()
  private readonly signLocal = new THREE.Vector3()
  private scale = 110
  private bloomStage: 0 | 1 | 2 | 3 | 4 = 0

  get isLoaded(): boolean {
    return this.model != null
  }

  async load(bytes: ArrayBuffer, gradientMap: THREE.DataTexture): Promise<void> {
    const loader = new GLTFLoader()
    const gltf = await loader.parseAsync(bytes, '')
    this.model = gltf.scene
    this.model.name = 'tree'
    toonify(this.model, gradientMap)

    for (let i = 0; i < 6; i++) {
      const node = this.model.getObjectByName(`foliage_${i}`)
      if (!node) continue
      const visible = i < BLOOM.baseClusters
      node.visible = visible
      node.scale.setScalar(visible ? 1 : 0)
      this.clusters.push({
        node,
        phase: i * 0.9,
        target: visible ? 1 : 0,
        current: visible ? 1 : 0,
        popping: null
      })
    }

    const seat = this.model.getObjectByName('seat_marker')
    if (seat) seat.getWorldPosition(this.seatLocal)
    const canopy = this.model.getObjectByName('canopy_center')
    if (canopy) canopy.getWorldPosition(this.canopyLocal)
    const sign = this.model.getObjectByName('sign_anchor')
    if (sign) sign.getWorldPosition(this.signLocal)

    this.group.add(this.model)
    this.group.name = 'diorama'
  }

  setHeight(px: number): void {
    this.scale = px
    this.group.scale.setScalar(px)
  }

  /** Tree growth reward: one new cluster per session, popped in with back-out. */
  setBloom(stage: 0 | 1 | 2 | 3 | 4): void {
    if (stage === this.bloomStage) return
    this.bloomStage = stage
    const visibleCount = BLOOM.baseClusters + stage
    this.clusters.forEach((cluster, index) => {
      const shouldShow = index < visibleCount
      if (shouldShow && cluster.target === 0) {
        cluster.node.visible = true
        cluster.target = 1
        cluster.popping = 0
      } else if (!shouldShow) {
        cluster.target = 0
        cluster.current = 0
        cluster.node.visible = false
        cluster.node.scale.setScalar(0)
      }
    })
  }

  update(dt: number, now: number): void {
    // Per-cluster sway: a gentle procedural sine, ±1.5° over 400 ms (§4.5).
    for (const cluster of this.clusters) {
      if (cluster.popping != null) {
        cluster.popping += (dt * 1000) / BLOOM.popMs
        if (cluster.popping >= 1) {
          cluster.popping = null
          cluster.current = 1
        } else {
          cluster.current = easeOutBack(cluster.popping)
        }
      }
      const sway = THREE.MathUtils.degToRad(SWAY_DEGREES) * Math.sin((now / SWAY_PERIOD_MS) * Math.PI * 2 + cluster.phase)
      cluster.node.rotation.z = sway
      cluster.node.scale.setScalar(Math.max(0.0001, cluster.current))
    }
  }

  /** Where the Buddha sits, in window coordinates (the renderer adds petPos). */
  get seatOffset(): THREE.Vector3 {
    return this.seatLocal.clone().multiplyScalar(this.scale)
  }

  get canopyOffset(): THREE.Vector3 {
    return this.canopyLocal.clone().multiplyScalar(this.scale)
  }

  get signOffset(): THREE.Vector3 {
    return this.signLocal.clone().multiplyScalar(this.scale)
  }

  get canopySpread(): number {
    return this.scale * 1.6
  }

  /** Rough island half-width in px, for the tree-scene stroll clamp. */
  get islandHalfWidth(): number {
    return this.scale * 0.91
  }
}
