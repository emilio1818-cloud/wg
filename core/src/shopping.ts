import type { ExpenseCategory, ItemCategory } from './types.ts';

/** Display order of categories, roughly following a supermarket walk-through. */
export const ITEM_CATEGORY_ORDER: ItemCategory[] = [
  'produce',
  'bakery',
  'dairy',
  'meat',
  'frozen',
  'pantry',
  'snacks',
  'drinks',
  'household',
  'drugstore',
  'home',
  'tools',
  'other',
];

export const ITEM_CATEGORY_EMOJI: Record<ItemCategory, string> = {
  produce: '🥦',
  bakery: '🥖',
  dairy: '🧀',
  meat: '🥩',
  frozen: '🧊',
  pantry: '🥫',
  snacks: '🍫',
  drinks: '🥤',
  household: '🧽',
  drugstore: '🧴',
  home: '🛋️',
  tools: '🔨',
  other: '📦',
};

/* Keywords (German + English, lowercase, umlauts folded). The longest match wins,
   so compound words like "zahnpasta" beat "pasta". */
const KEYWORDS: Record<Exclude<ItemCategory, 'other'>, string[]> = {
  produce: [
    'apfel', 'aepfel', 'banane', 'birne', 'zitrone', 'limette', 'orange', 'mandarine', 'traube', 'beere', 'erdbeer', 'himbeer', 'heidelbeer',
    'kiwi', 'mango', 'ananas', 'melone', 'avocado', 'tomate', 'gurke', 'paprika', 'salat', 'rucola', 'spinat', 'zwiebel', 'knoblauch',
    'kartoffel', 'karotte', 'moehre', 'brokkoli', 'blumenkohl', 'zucchini', 'aubergine', 'pilz', 'champignon', 'lauch', 'ingwer',
    'kraeuter', 'petersilie', 'basilikum', 'koriander', 'suesskartoffel', 'kohl', 'radieschen', 'sellerie', 'obst', 'gemuese', 'fruechte',
    'apple', 'banana', 'lemon', 'lime', 'grape', 'berries', 'tomato', 'cucumber', 'pepper', 'lettuce', 'spinach', 'onion', 'garlic',
    'potato', 'carrot', 'broccoli', 'mushroom', 'ginger', 'herbs', 'fruit', 'vegetable', 'veggies',
  ],
  bakery: ['brot', 'broetchen', 'semmel', 'toast', 'baguette', 'brezel', 'croissant', 'kuchen', 'wrap', 'tortilla', 'bread', 'bagel', 'buns', 'knaeckebrot'],
  dairy: [
    'milch', 'hafermilch', 'sojamilch', 'joghurt', 'jogurt', 'quark', 'kaese', 'butter', 'sahne', 'schmand', 'frischkaese', 'mozzarella',
    'feta', 'parmesan', 'gouda', 'skyr', 'eier', 'ei ', 'margarine', 'milk', 'yogurt', 'yoghurt', 'cheese', 'cream', 'eggs', 'oatly',
  ],
  meat: ['steak', 'fleisch', 'hackfleisch', 'hack', 'haehnchen', 'huhn', 'wurst', 'salami', 'schinken', 'speck', 'lachs', 'fisch', 'thunfisch', 'garnelen', 'tofu', 'chicken', 'beef', 'pork', 'bacon', 'ham', 'salmon', 'fish', 'sausage'],
  frozen: ['tiefkuehl', 'tk ', 'pizza', 'eis', 'eiscreme', 'pommes', 'frozen', 'ice cream', 'fischstaebchen'],
  pantry: [
    'nudeln', 'pasta', 'spaghetti', 'reis', 'mehl', 'zucker', 'salz', 'pfeffer', 'oel', 'olivenoel', 'essig', 'muesli', 'haferflocken',
    'cornflakes', 'honig', 'marmelade', 'nutella', 'erdnussbutter', 'konserve', 'dose', 'bohnen', 'linsen', 'kichererbsen', 'mais',
    'tomatenmark', 'passierte', 'bruehe', 'gewuerz', 'senf', 'ketchup', 'mayo', 'pesto', 'sosse', 'sauce', 'kaffee', 'tee', 'kakao',
    'rice', 'flour', 'sugar', 'salt', 'oil', 'vinegar', 'cereal', 'oats', 'honey', 'jam', 'beans', 'coffee', 'tea', 'spices', 'noodles',
  ],
  snacks: ['chips', 'schokolade', 'schoki', 'kekse', 'gummibaerchen', 'nuesse', 'cracker', 'popcorn', 'riegel', 'suessigkeiten', 'chocolate', 'cookies', 'candy', 'snack', 'nuts'],
  drinks: [
    'wasser', 'sprudel', 'saft', 'cola', 'limo', 'mate', 'bier', 'wein', 'sekt', 'prosecco', 'gin', 'vodka', 'rum', 'tonic', 'eistee',
    'energy', 'water', 'juice', 'beer', 'wine', 'soda', 'getraenke', 'kasten',
  ],
  household: [
    'klopapier', 'toilettenpapier', 'kuechenrolle', 'kuechenpapier', 'taschentuecher', 'spuelmittel', 'spuelmaschinentabs', 'tabs',
    'muellbeutel', 'muelltueten', 'schwamm', 'schwaemme', 'putzmittel', 'allzweckreiniger', 'badreiniger', 'wc reiniger', 'entkalker',
    'waschmittel', 'weichspueler', 'alufolie', 'frischhaltefolie', 'backpapier', 'gefrierbeutel', 'batterien', 'gluehbirne', 'kerzen',
    'servietten', 'toilet paper', 'paper towels', 'dish soap', 'detergent', 'trash bags', 'sponge', 'cleaner', 'batteries', 'foil',
  ],
  drugstore: [
    'zahnpasta', 'zahnbuerste', 'zahnseide', 'shampoo', 'spuelung', 'duschgel', 'seife', 'deo', 'deodorant', 'creme', 'bodylotion',
    'sonnencreme', 'rasierer', 'rasierschaum', 'wattepads', 'wattestaebchen', 'tampons', 'binden', 'kondome', 'pflaster', 'ibuprofen',
    'paracetamol', 'vitamine', 'handseife', 'abschminktuecher', 'haargel', 'nagellack', 'make-up', 'mascara', 'lippenpflege',
    'toothpaste', 'toothbrush', 'soap', 'shower gel', 'lotion', 'sunscreen', 'razor', 'plasters', 'painkillers',
  ],
  home: [
    'teelicht', 'lampe', 'regal', 'kissen', 'decke', 'teppich', 'vorhang', 'gardine', 'spiegel', 'bilderrahmen', 'kleiderbuegel', 'aufbewahrung',
    'box', 'korb', 'pflanze', 'topf', 'pfanne', 'teller', 'tasse', 'glaeser', 'besteck', 'handtuch', 'bettwaesche', 'stuhl', 'tisch',
    'lamp', 'shelf', 'pillow', 'blanket', 'rug', 'curtain', 'mirror', 'hangers', 'storage', 'plates', 'cups', 'glasses', 'cutlery', 'towel',
  ],
  tools: ['schrauben', 'duebel', 'hammer', 'bohrer', 'akkuschrauber', 'farbe', 'pinsel', 'klebeband', 'kabelbinder', 'silikon', 'werkzeug', 'screws', 'drill', 'paint', 'tape', 'tools'],
};

function fold(s: string): string {
  return ` ${s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')} `;
}

const KEYWORD_INDEX: { kw: string; cat: ItemCategory }[] = Object.entries(KEYWORDS)
  .flatMap(([cat, kws]) => kws.map((kw) => ({ kw, cat: cat as ItemCategory })))
  .sort((a, b) => b.kw.length - a.kw.length);

export function categorizeItem(name: string): ItemCategory {
  const s = fold(name);
  for (const { kw, cat } of KEYWORD_INDEX) {
    if (s.includes(kw)) return cat;
  }
  return 'other';
}

/** Splits "2x Milch", "Milch 2l", "3 Äpfel" into quantity and name. */
export function parseItemInput(input: string): { name: string; quantity?: string } {
  const s = input.trim().replace(/\s+/g, ' ');
  const unit = '(?:x|×|stk\\.?|st\\.?|kg|g|l|ml|pck\\.?|packungen?|pack|dosen?|flaschen?|bund|becher|gläser|glas)';
  const lead = s.match(new RegExp(`^(\\d+(?:[.,]\\d+)?\\s*${unit}?)\\s+(.+)$`, 'i'));
  if (lead) return { quantity: lead[1]!.replace(/\s+/g, ''), name: capitalize(lead[2]!) };
  const trail = s.match(new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?\\s*${unit}?)$`, 'i'));
  if (trail) return { quantity: trail[2]!.replace(/\s+/g, ''), name: capitalize(trail[1]!) };
  return { name: capitalize(s) };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Expense category for a shopping trip, based on what was bought. */
export function expenseCategoryForItems(categories: ItemCategory[]): ExpenseCategory {
  const counts = new Map<ExpenseCategory, number>();
  for (const c of categories) {
    const e: ExpenseCategory =
      c === 'drugstore' ? 'drugstore' : c === 'household' ? 'household' : c === 'home' || c === 'tools' ? 'furniture' : c === 'drinks' ? 'drinks' : 'groceries';
    counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  let best: ExpenseCategory = 'groceries';
  let max = 0;
  for (const [k, v] of counts) if (v > max) [best, max] = [k, v];
  return best;
}

/** Default quick-add suggestions per list type (German + English names chosen at render time). */
export const LIST_SUGGESTIONS: Record<string, { de: string[]; en: string[] }> = {
  supermarket: {
    de: ['Milch', 'Brot', 'Eier', 'Bananen', 'Nudeln', 'Tomaten', 'Käse', 'Butter', 'Kaffee', 'Äpfel', 'Zwiebeln', 'Joghurt'],
    en: ['Milk', 'Bread', 'Eggs', 'Bananas', 'Pasta', 'Tomatoes', 'Cheese', 'Butter', 'Coffee', 'Apples', 'Onions', 'Yogurt'],
  },
  drugstore: {
    de: ['Klopapier', 'Zahnpasta', 'Duschgel', 'Shampoo', 'Spülmittel', 'Küchenrolle', 'Müllbeutel', 'Waschmittel', 'Handseife', 'Deo'],
    en: ['Toilet paper', 'Toothpaste', 'Shower gel', 'Shampoo', 'Dish soap', 'Paper towels', 'Trash bags', 'Detergent', 'Hand soap', 'Deodorant'],
  },
  home: {
    de: ['Kerzen', 'Kleiderbügel', 'Aufbewahrungsboxen', 'Teelichter', 'Gläser', 'Handtücher', 'Pflanze', 'Lampe'],
    en: ['Candles', 'Hangers', 'Storage boxes', 'Tea lights', 'Glasses', 'Towels', 'Plant', 'Lamp'],
  },
  drinks: {
    de: ['Wasser', 'Bier', 'Club-Mate', 'Saft', 'Cola', 'Tonic'],
    en: ['Water', 'Beer', 'Club-Mate', 'Juice', 'Cola', 'Tonic'],
  },
  hardware: {
    de: ['Glühbirne', 'Batterien', 'Schrauben', 'Klebeband', 'Dübel', 'Farbe'],
    en: ['Light bulb', 'Batteries', 'Screws', 'Tape', 'Wall plugs', 'Paint'],
  },
};

/** Infers which suggestion set fits a list name. */
export function listKind(name: string, emoji: string): keyof typeof LIST_SUGGESTIONS {
  const s = fold(name + ' ' + emoji);
  if (/dm|rossmann|drogerie|drugstore|muller|mueller|🧴|🧻/.test(s)) return 'drugstore';
  if (/ikea|moebel|wohnen|furniture|home|🛋/.test(s)) return 'home';
  if (/getraenk|drinks|bier|beer|🍺|🥤/.test(s)) return 'drinks';
  if (/bau|obi|hornbach|hardware|werkzeug|🔨/.test(s)) return 'hardware';
  return 'supermarket';
}
