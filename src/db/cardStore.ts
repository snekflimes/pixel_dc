import Dexie, { type Table } from 'dexie'
import type { CardDef } from '../cardCombat/types'
import cardsSeedBundled from '../data/cardsSeed.json' with { type: 'json' }

/** Локальное хранилище карт в браузере (IndexedDB через Dexie). Синхронный серверный SQL здесь не используется — FTP отдаёт только статику. */

class PixelCardDb extends Dexie {
  cards!: Table<CardDef, string>

  constructor() {
    super('pixel_dc_cards_v1')
    this.version(1).stores({
      cards: 'id',
    })
  }
}

const db = new PixelCardDb()
let memory = new Map<string, CardDef>()

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parseOneCard(o: unknown): CardDef {
  if (!o || typeof o !== 'object') {
    throw new Error('Карта должна быть объектом')
  }
  const x = o as Record<string, unknown>
  const id = String(x.id ?? '').trim()
  if (!id) throw new Error('У карты нужен непустой id')
  const t = x.type
  if (t !== 'attack' && t !== 'defense' && t !== 'skill') {
    throw new Error(`Карта ${id}: type должен быть attack | defense | skill`)
  }
  const type = t
  const name = String(x.name ?? '')
  const description = String(x.description ?? '')
  const enabled = x.enabled === false ? false : true

  const card: CardDef = { id, name, type, description, enabled }

  if (type === 'attack') {
    card.damage = Math.max(0, Math.round(num(x.damage, 0)))
  } else if (type === 'defense') {
    card.block = Math.max(0, Math.round(num(x.block, 0)))
  } else {
    card.heal = Math.max(0, Math.round(num(x.heal, 0)))
  }
  return card
}

export function parseCardsJson(text: string): CardDef[] {
  const raw = JSON.parse(text) as unknown
  if (!Array.isArray(raw)) {
    throw new Error('Ожидается JSON-массив карт')
  }
  return raw.map(parseOneCard)
}

async function loadSeedFromNetwork(): Promise<CardDef[] | null> {
  try {
    const path = `${import.meta.env.BASE_URL}data/cards.json`
    const r = await fetch(path, { cache: 'no-store' })
    if (!r.ok) return null
    const data = (await r.json()) as unknown
    if (!Array.isArray(data)) return null
    try {
      return data.map(parseOneCard)
    } catch {
      return null
    }
  } catch {
    return null
  }
}

function loadBundledSeed(): CardDef[] {
  const data = cardsSeedBundled as unknown
  if (!Array.isArray(data)) throw new Error('Встроенный сид повреждён')
  return data.map(parseOneCard)
}

async function refreshMemory(): Promise<void> {
  const rows = await db.cards.toArray()
  memory = new Map(rows.map((c) => [c.id, c]))
}

export async function initCardDatabase(): Promise<void> {
  const count = await db.cards.count()
  if (count === 0) {
    const fromNet = await loadSeedFromNetwork()
    const seed = fromNet ?? loadBundledSeed()
    if (seed.length < 2) {
      throw new Error('В колоде должно быть минимум 2 карты')
    }
    await db.cards.bulkPut(seed)
  }
  await refreshMemory()
}

export function getCardById(id: string): CardDef {
  const c = memory.get(id)
  if (!c) throw new Error(`Неизвестная карта: ${id}`)
  return c
}

export function getEnabledCardIds(): string[] {
  const ids: string[] = []
  for (const c of memory.values()) {
    if (c.enabled !== false) ids.push(c.id)
  }
  ids.sort()
  return ids
}

export async function saveAllCardsFromJson(text: string): Promise<void> {
  const parsed = parseCardsJson(text)
  const enabled = parsed.filter((c) => c.enabled !== false)
  if (enabled.length < 2) {
    throw new Error('Нужно минимум 2 включённые карты (enabled не false)')
  }
  await db.cards.clear()
  await db.cards.bulkPut(parsed)
  await refreshMemory()
}

export async function resetCardsToDefault(): Promise<void> {
  const fromNet = await loadSeedFromNetwork()
  const seed = fromNet ?? loadBundledSeed()
  await db.cards.clear()
  await db.cards.bulkPut(seed)
  await refreshMemory()
}

export async function exportCardsJsonPretty(): Promise<string> {
  const rows = await db.cards.orderBy('id').toArray()
  return `${JSON.stringify(rows, null, 2)}\n`
}

/** Список карт для UI редактора. */
export async function getAllCardsOrdered(): Promise<CardDef[]> {
  return db.cards.orderBy('id').toArray()
}

/** Сохранение набора карт из формы (без JSON). */
export async function saveAllCards(cards: CardDef[]): Promise<void> {
  const ids = new Set<string>()
  for (const c of cards) {
    const id = String(c.id ?? '').trim()
    if (!id) {
      throw new Error('У каждой карты должен быть короткий код (поле «Код»).')
    }
    if (ids.has(id)) {
      throw new Error(`Код «${id}» встречается дважды. Задайте уникальные коды.`)
    }
    ids.add(id)
  }
  const normalized = cards.map((c) =>
    parseOneCard(JSON.parse(JSON.stringify(c)) as unknown)
  )
  const enabled = normalized.filter((k) => k.enabled !== false)
  if (enabled.length < 2) {
    throw new Error('Отметьте минимум две карты галочкой «В колоде».')
  }
  await db.cards.clear()
  await db.cards.bulkPut(normalized)
  await refreshMemory()
}
