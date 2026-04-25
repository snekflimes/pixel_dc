import { getCardById } from './cards'
import type { CardDef } from './types'

const COLS = 4
const ROWS = 2

/** Детерминированный RNG из строки (PvP: одинаковый сид на обоих клиентах). */
export function seedStringToRng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let state = h >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Колода: сетка 2×4 как «очередь»; активный столбец — всегда слева (col 0).
 * После хода столбец сбрасывается (обе карты в сброс), сетка сдвигается влево, справа добор.
 */
export class Deck {
  private draw: string[] = []
  private discard: string[] = []
  private readonly poolIds: readonly string[]
  private readonly rng: () => number
  private grid: CardDef[][] | null = null

  constructor(poolIds: readonly string[], rng: () => number) {
    this.poolIds = poolIds
    this.rng = rng
    this.draw = [...poolIds]
    this.shuffleInPlace(this.draw)
  }

  private shuffleInPlace(ids: string[]): void {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      const a = ids[i]!
      const b = ids[j]!
      ids[i] = b
      ids[j] = a
    }
  }

  private replenishIfNeeded(minNeed: number): void {
    if (this.draw.length >= minNeed) return
    let merged = [...this.discard, ...this.draw]
    this.discard = []
    if (merged.length < minNeed) {
      merged = [...this.poolIds]
    }
    this.draw = merged
    this.shuffleInPlace(this.draw)
  }

  private popId(): string {
    this.replenishIfNeeded(1)
    const id = this.draw.pop()
    if (!id) {
      throw new Error('Deck: пул карт пуст')
    }
    return id
  }

  private drawCardDef(): CardDef {
    return getCardById(this.popId())
  }

  hasGrid(): boolean {
    return this.grid !== null
  }

  /** Первичная выкладка 2×4. */
  initBattleGrid(): CardDef[][] {
    const g: CardDef[][] = []
    for (let row = 0; row < ROWS; row++) {
      const r: CardDef[] = []
      for (let col = 0; col < COLS; col++) {
        r.push(this.drawCardDef())
      }
      g.push(r)
    }
    this.grid = g
    return g
  }

  getGrid(): CardDef[][] {
    if (!this.grid) {
      throw new Error('Deck: сетка не инициализирована')
    }
    return this.grid
  }

  /**
   * После розыгрыша из левого столбца: обе карты столбца в сброс, сдвиг влево, новый правый столбец.
   */
  advanceAfterPlay(_playedRow: 0 | 1): void {
    if (!this.grid) {
      throw new Error('Deck: сетка не инициализирована')
    }
    const col = 0
    for (let row = 0; row < ROWS; row++) {
      const c = this.grid[row]![col]!
      this.discard.push(c.id)
    }
    for (let row = 0; row < ROWS; row++) {
      for (let c = 0; c < COLS - 1; c++) {
        this.grid[row]![c] = this.grid[row]![c + 1]!
      }
      this.grid[row]![COLS - 1] = this.drawCardDef()
    }
  }

  /** Совместимость: старый код сбрасывал «руку» в сброс — здесь no-op при сдвигающейся сетке. */
  afterRound(_cards: CardDef[]): void {
    /* сетка управляется через advanceAfterPlay */
  }
}
