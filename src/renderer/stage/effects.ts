import * as THREE from 'three'
import { PALETTE } from '@shared/palette'
import { WALK } from '@shared/constants'

/**
 * Procedural effects (§4.3): falling leaves, dust puffs at footfalls, canopy
 * blossoms and night fireflies — all one InstancedMesh with per-instance
 * colour, so the whole particle system costs a single draw call (§4.1, §5.7).
 */
export type ParticleKind = 'leaf' | 'dust' | 'blossom' | 'firefly'

interface Particle {
  kind: ParticleKind
  position: THREE.Vector3
  velocity: THREE.Vector3
  life: number
  maxLife: number
  size: number
  spin: number
  phase: number
  active: boolean
}

const CAPACITY = 256

export class Particles {
  readonly mesh: THREE.InstancedMesh
  private readonly items: Particle[] = []
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()
  private gustTimer = 0

  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    this.mesh = new THREE.InstancedMesh(geometry, material, CAPACITY)
    this.mesh.name = 'particles'
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = CAPACITY

    const colors = new Float32Array(CAPACITY * 3)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)

    for (let i = 0; i < CAPACITY; i++) {
      this.items.push({
        kind: 'leaf',
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size: 0,
        spin: 0,
        phase: Math.random() * Math.PI * 2,
        active: false
      })
      this.hideInstance(i)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  private free(): Particle | null {
    for (const item of this.items) if (!item.active) return item
    return null
  }

  spawnLeaf(origin: THREE.Vector3, spread: number, scale: number): void {
    const item = this.free()
    if (!item) return
    item.kind = 'leaf'
    item.active = true
    item.maxLife = 5 + Math.random() * 3
    item.life = item.maxLife
    item.size = 5 * scale * (0.8 + Math.random() * 0.5)
    item.position.set(
      origin.x + (Math.random() - 0.5) * spread,
      origin.y + (Math.random() - 0.5) * spread * 0.4,
      origin.z + (Math.random() - 0.5) * spread * 0.5
    )
    item.velocity.set(0, -(18 + Math.random() * 14) * scale, 0)
    item.phase = Math.random() * Math.PI * 2
    item.spin = (Math.random() - 0.5) * 1.6
  }

  spawnDust(origin: THREE.Vector3, scale: number): void {
    const item = this.free()
    if (!item) return
    item.kind = 'dust'
    item.active = true
    item.maxLife = 0.7
    item.life = item.maxLife
    item.size = 7 * scale
    item.position.copy(origin)
    item.velocity.set((Math.random() - 0.5) * 20 * scale, 14 * scale, 0)
    item.phase = Math.random() * Math.PI * 2
    item.spin = 0
  }

  spawnBlossom(origin: THREE.Vector3, scale: number): void {
    const item = this.free()
    if (!item) return
    item.kind = 'blossom'
    item.active = true
    item.maxLife = Number.POSITIVE_INFINITY
    item.life = 1
    item.size = 5 * scale
    item.position.copy(origin)
    item.velocity.set(0, 0, 0)
    item.phase = Math.random() * Math.PI * 2
    item.spin = 0
  }

  spawnFirefly(origin: THREE.Vector3, spread: number, scale: number): void {
    const item = this.free()
    if (!item) return
    item.kind = 'firefly'
    item.active = true
    item.maxLife = Number.POSITIVE_INFINITY
    item.life = 1
    item.size = 4 * scale
    item.position.set(
      origin.x + (Math.random() - 0.5) * spread,
      origin.y + (Math.random() - 0.5) * spread * 0.5,
      origin.z + (Math.random() - 0.5) * spread * 0.4
    )
    item.velocity.set(0, 0, 0)
    item.phase = Math.random() * Math.PI * 2
    item.spin = 0
  }

  clearKind(kind: ParticleKind): void {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].kind === kind) {
        this.items[i].active = false
        this.hideInstance(i)
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  countKind(kind: ParticleKind): number {
    return this.items.filter((item) => item.kind === kind && item.active).length
  }

  /**
   * @param leafBudget how many leaves should be in the air during focus (~20)
   */
  update(dt: number, now: number, options: {
    leafBudget: number
    canopy: THREE.Vector3
    canopySpread: number
    scale: number
    gustEveryMs: number
  }): void {
    const { leafBudget, canopy, canopySpread, scale, gustEveryMs } = options

    // Gusts: every ~20 s five leaves drop at once (§4.5).
    if (leafBudget > 0) {
      this.gustTimer += dt * 1000
      if (this.gustTimer >= gustEveryMs) {
        this.gustTimer = 0
        for (let i = 0; i < 5; i++) this.spawnLeaf(canopy, canopySpread, scale)
      }
      while (this.countKind('leaf') < leafBudget) {
        this.spawnLeaf(canopy, canopySpread, scale)
      }
    }

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]
      if (!item.active) continue

      if (item.kind === 'leaf') {
        item.life -= dt
        if (item.life <= 0) {
          item.active = false
          this.hideInstance(i)
          continue
        }
        // gentle S-curve descent
        item.position.y += item.velocity.y * dt
        item.position.x += Math.sin(now / 900 + item.phase) * 16 * dt * scale
        item.position.z += Math.cos(now / 1100 + item.phase) * 6 * dt * scale
        this.dummy.position.copy(item.position)
        this.dummy.rotation.set(0, 0, Math.sin(now / 700 + item.phase) * 0.9 * item.spin)
      } else if (item.kind === 'dust') {
        item.life -= dt
        if (item.life <= 0) {
          item.active = false
          this.hideInstance(i)
          continue
        }
        item.position.addScaledVector(item.velocity, dt)
        item.velocity.y -= 30 * dt * scale
        this.dummy.position.copy(item.position)
        this.dummy.rotation.set(0, 0, 0)
      } else if (item.kind === 'firefly') {
        item.position.x += Math.sin(now / 2600 + item.phase) * 6 * dt * scale
        item.position.y += Math.cos(now / 2100 + item.phase) * 4 * dt * scale
        this.dummy.position.copy(item.position)
        this.dummy.rotation.set(0, 0, 0)
      } else {
        // blossoms sit still, barely breathing
        this.dummy.position.copy(item.position)
        this.dummy.rotation.set(0, 0, item.phase)
      }

      const fade =
        item.kind === 'dust'
          ? Math.max(0, item.life / item.maxLife)
          : item.kind === 'leaf'
            ? Math.min(1, item.life / 0.8)
            : item.kind === 'firefly'
              ? 0.55 + 0.45 * Math.sin(now / 700 + item.phase)
              : 1

      const grow = item.kind === 'dust' ? 1.6 - fade : 1
      this.dummy.scale.setScalar(item.size * grow)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)

      if (item.kind === 'leaf') {
        this.color.set(Math.random() > 0.5 ? PALETTE.leafLight : PALETTE.leafDark)
      } else if (item.kind === 'dust') {
        this.color.set('#E8DCC8')
      } else if (item.kind === 'firefly') {
        this.color.set('#FFE9A8')
      } else {
        this.color.set(PALETTE.blossom)
      }
      this.color.multiplyScalar(item.kind === 'blossom' ? 1 : 1)
      this.mesh.setColorAt(i, this.color)
    }

    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  /** Dust puff cadence while walking (§4.6). */
  maybeFootfall(now: number, lastPuff: number, position: THREE.Vector3, scale: number): number {
    if (now - lastPuff < WALK.dustIntervalMs) return lastPuff
    this.spawnDust(position, scale)
    return now
  }

  private hideInstance(index: number): void {
    this.dummy.position.set(0, 0, 0)
    this.dummy.scale.setScalar(0)
    this.dummy.rotation.set(0, 0, 0)
    this.dummy.updateMatrix()
    this.mesh.setMatrixAt(index, this.dummy.matrix)
  }
}

/**
 * The focus progress ring: a flat gold ring behind the seated Buddha that fills
 * clockwise (§4.5). One mesh, shader-driven, no CPU cost per frame.
 */
export class AuraRing {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.ShaderMaterial

  constructor(radiusPx: number, thicknessPx: number) {
    const geometry = new THREE.RingGeometry(radiusPx - thicknessPx / 2, radiusPx + thicknessPx / 2, 64)
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uOpacity: { value: 1 },
        uColor: { value: new THREE.Color(PALETTE.auraGold) }
      },
      vertexShader: /* glsl */ `
        varying vec2 vLocal;
        void main() {
          vLocal = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vLocal;
        uniform float uProgress;
        uniform float uOpacity;
        uniform vec3 uColor;
        const float TWO_PI = 6.28318530718;
        void main() {
          float angle = atan(vLocal.y, vLocal.x);
          // 0 at the top, increasing clockwise
          float t = mod(1.5707963 - angle, TWO_PI) / TWO_PI;
          if (t > uProgress) discard;
          gl_FragColor = vec4(uColor, uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.name = 'aura-ring'
    this.mesh.visible = false
  }

  setProgress(progress: number): void {
    this.material.uniforms.uProgress.value = Math.max(0, Math.min(1, progress))
  }

  /** Paused focus dims the ring to 30% (§2.1). */
  setDimmed(dimmed: boolean): void {
    this.material.uniforms.uOpacity.value = dimmed ? 0.3 : 1
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible
  }
}
