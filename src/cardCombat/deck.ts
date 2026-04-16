import { getCardById } from './cards'
import type { CardDef } from './types'

const CARDS_PER_ROUND = 8

/** Колода: за раунд снимается 8 карт (сетка 2×4); сброс; при нехватке — перемешать сброс. */
export class Deck {
  private draw: string[] = []
  private discard: string[] = []
  private readonly poolIds: readonly string[]
  private readonly rng: () => number

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

  private replenishIfNeeded(): void {
    if (this.draw.length >= CARDS_PER_ROUND) return
    let merged = [...this.discard, ...this.draw]
    this.discard = []
    if (merged.length < CARDS_PER_ROUND) {
      merged = [...this.poolIds]
    }
    this.draw = merged
    this.shuffleInPlace(this.draw)
  }

  /** Восемь карт для сетки 2×4 (порядок: верхний ряд слева направо, затем нижний). */
  drawEight(): CardDef[] {
    this.replenishIfNeeded()
    const out: CardDef[] = []
    for (let i = 0; i < CARDS_PER_ROUND; i++) {
      const id = this.draw.pop()
      if (!id) {
        throw new Error('Deck: в колоде не хватает карт (нужно ≥8 в пуле типов)')
      }
      out.push(getCardById(id))
    }
    return out
  }

  toGrid(flat: CardDef[]): CardDef[][] {
    return [flat.slice(0, 4), flat.slice(4, 8)]
  }

  afterRound(cards: CardDef[]): void {
    for (const c of cards) {
      this.discard.push(c.id)
    }
  }
}
