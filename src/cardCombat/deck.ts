import { getCardById } from './cards'
import type { CardDef } from './types'

/** Колода игрока: две карты на раунд, обе уходят в сброс; при пустой стопке — перемешать сброс. */
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
    if (this.draw.length >= 2) return
    let merged = [...this.discard, ...this.draw]
    this.discard = []
    if (merged.length < 2) {
      merged = [...this.poolIds]
    }
    this.draw = merged
    this.shuffleInPlace(this.draw)
  }

  drawTwo(): [CardDef, CardDef] {
    this.replenishIfNeeded()
    const id1 = this.draw.pop()
    const id2 = this.draw.pop()
    if (!id1 || !id2) {
      throw new Error('Deck.drawTwo: нужно минимум 2 карты в пуле колоды')
    }
    return [getCardById(id1), getCardById(id2)]
  }

  afterRound(a: CardDef, b: CardDef): void {
    this.discard.push(a.id, b.id)
  }
}
