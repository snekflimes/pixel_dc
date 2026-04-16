/**
 * Карты загружаются из IndexedDB (Dexie) после {@link initCardDatabase}.
 * Редактирование — меню «База карт» или JSON на сервере `/data/cards.json` при первом запуске пустой БД.
 */
export {
  initCardDatabase,
  getCardById,
  getEnabledCardIds,
  resetCardsToDefault,
  saveAllCardsFromJson,
  exportCardsJsonPretty,
  parseCardsJson,
} from '../db/cardStore'
