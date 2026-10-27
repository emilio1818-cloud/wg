import type { EventType, ExpenseCategory } from './types.ts';

export interface CategoryMeta {
  emoji: string;
  /** Hue used for tiles and charts. */
  color: string;
}

export const EXPENSE_CATEGORIES: Record<ExpenseCategory, CategoryMeta> = {
  groceries: { emoji: '🛒', color: '#22C55E' },
  drugstore: { emoji: '🧴', color: '#EC4899' },
  household: { emoji: '🧽', color: '#06B6D4' },
  rent: { emoji: '🔑', color: '#6366F1' },
  utilities: { emoji: '⚡', color: '#F59E0B' },
  internet: { emoji: '🌐', color: '#3B82F6' },
  insurance: { emoji: '🛡️', color: '#64748B' },
  subscriptions: { emoji: '🎬', color: '#A855F7' },
  furniture: { emoji: '🛋️', color: '#D97706' },
  food: { emoji: '🍕', color: '#EF4444' },
  drinks: { emoji: '🍻', color: '#EAB308' },
  party: { emoji: '🎉', color: '#F43F5E' },
  transport: { emoji: '🚲', color: '#14B8A6' },
  repairs: { emoji: '🔧', color: '#78716C' },
  other: { emoji: '💸', color: '#8B5CF6' },
};

export const EXPENSE_CATEGORY_ORDER = Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[];

const TITLE_HINTS: [RegExp, ExpenseCategory][] = [
  [/\b(miete|rent|kaution|nebenkosten)\b/i, 'rent'],
  [/(strom|gas|wasser|heizung|stadtwerke|vattenfall|eon|e\.on|enbw|electricity|utilities|heating)/i, 'utilities'],
  [/(internet|wlan|wifi|dsl|glasfaser|telekom|vodafone|o2|1&1|router)/i, 'internet'],
  [/(versicherung|haftpflicht|hausrat|insurance)/i, 'insurance'],
  [/(netflix|spotify|disney|prime|youtube|rundfunk|gez|abo|subscription|hbo|apple tv|dazn)/i, 'subscriptions'],
  [/(ikea|möbel|moebel|sofa|regal|lampe|furniture|couch|teppich)/i, 'furniture'],
  [/(\bdm\b|rossmann|müller drogerie|drogerie|drugstore|zahnpasta|shampoo|klopapier|toilettenpapier)/i, 'drugstore'],
  [/(putzmittel|spülmittel|spuelmittel|müllbeutel|muellbeutel|reiniger|schwamm|waschmittel|cleaning)/i, 'household'],
  [/(pizza|döner|doener|sushi|burger|lieferando|wolt|essen|restaurant|takeaway|take-away|dinner|lunch|brunch|kebab)/i, 'food'],
  [/(bier|beer|wein|wine|getränke|getraenke|drinks|mate|schnaps|kasten|cocktail)/i, 'drinks'],
  [/(party|geburtstag|birthday|feier|deko|wg-party)/i, 'party'],
  [/(bahn|bvg|mvg|hvv|ticket|taxi|uber|tanken|sprit|carsharing|share now|miles|transport|fahrrad)/i, 'transport'],
  [/(reparatur|handwerker|klempner|schlüssel|schluessel|repair|plumber|werkzeug|baumarkt|obi|hornbach)/i, 'repairs'],
  [/(rewe|edeka|lidl|aldi|netto|penny|kaufland|einkauf|supermarkt|lebensmittel|groceries|bio|markt|bäcker|baecker)/i, 'groceries'],
];

/** Guesses the expense category from its title, or null when unsure. */
export function guessExpenseCategory(title: string): ExpenseCategory | null {
  for (const [re, cat] of TITLE_HINTS) if (re.test(title)) return cat;
  return null;
}

export const EVENT_TYPES: Record<EventType, CategoryMeta> = {
  party: { emoji: '🎉', color: '#F43F5E' },
  guest: { emoji: '👋', color: '#F59E0B' },
  repair: { emoji: '🔧', color: '#64748B' },
  meeting: { emoji: '🗣️', color: '#6366F1' },
  away: { emoji: '🧳', color: '#14B8A6' },
  other: { emoji: '📌', color: '#A855F7' },
};

/** Avatar palette — vibrant hues that work on light and dark backgrounds. */
export const MEMBER_COLORS = ['#7C5CFF', '#FF6B6B', '#10B981', '#F59E0B', '#3B82F6', '#EC4899', '#14B8A6', '#F97316', '#8B5CF6', '#84CC16'];

export const AVATAR_EMOJIS = ['😎', '🦊', '🐼', '🐸', '🦄', '🐙', '🌻', '🍕', '🎧', '🚀', '🌈', '🐝', '🦖', '🍉', '🎸', '⚡', '🐨', '🌵', '🍩', '👾'];

export const HOUSEHOLD_EMOJIS = ['🏠', '🏡', '🏰', '🪴', '🌿', '🦄', '🍕', '🐝', '🌈', '🚀', '🎸', '🌻', '🐙', '🔥', '🌊', '🛸'];

export const NOTE_COLORS = ['#FFE66D', '#FFB4A2', '#B8F2E6', '#C3B1E1', '#A0E7E5', '#FFD6A5'];

export const LIST_COLORS = ['#22C55E', '#EC4899', '#F59E0B', '#3B82F6', '#A855F7', '#14B8A6'];
