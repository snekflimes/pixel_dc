/** Настройки боя из меню (сохраняются в localStorage). */
export interface BattleConfig {
  startHp: number
  turnSeconds: number
}

const STORAGE_KEY = 'pixel_dc_battle_config'

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  startHp: 100,
  turnSeconds: 15,
}

export function loadBattleConfig(): BattleConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_BATTLE_CONFIG }
    const o = JSON.parse(raw) as Partial<BattleConfig>
    return {
      startHp: clamp(
        typeof o.startHp === 'number' ? o.startHp : DEFAULT_BATTLE_CONFIG.startHp,
        20,
        300
      ),
      turnSeconds: clamp(
        typeof o.turnSeconds === 'number' ? o.turnSeconds : DEFAULT_BATTLE_CONFIG.turnSeconds,
        5,
        60
      ),
    }
  } catch {
    return { ...DEFAULT_BATTLE_CONFIG }
  }
}

export function saveBattleConfig(c: BattleConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

function clamp(n: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, n))
}
