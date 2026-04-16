export type CardType = 'attack' | 'defense' | 'skill'

/** Описание карты (data-driven; в проде — из БД/кэша). */
export interface CardDef {
  id: string
  name: string
  type: CardType
  description: string
  /** Для Attack */
  damage?: number
  /** Для Defense — поглощение урона противника при его Attack */
  block?: number
  /** Для Skill — лечение себя (MVP) */
  heal?: number
}

export interface RoundResolution {
  dmgToPlayer: number
  dmgToEnemy: number
  healPlayer: number
  healEnemy: number
  lines: string[]
}
