// Mazo español de 40 cartas + jerarquía y tanto del truco.

export const SUITS = ['espada', 'basto', 'oro', 'copa'];
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

// Jerarquía del truco (mayor número = carta más fuerte).
const SPECIAL_POWER = {
  '1-espada': 14,
  '1-basto': 13,
  '7-espada': 12,
  '7-oro': 11,
};

// Cartas "comunes": los 1 de oro/copa y los 7 de copa/basto valen menos.
const GENERIC_POWER = { 3: 10, 2: 9, 1: 8, 12: 7, 11: 6, 10: 5, 7: 4, 6: 3, 5: 2, 4: 1 };

export const FIGURE_LABEL = { 10: 'Sota', 11: 'Caballo', 12: 'Rey' };

export function cardId(rank, suit) {
  return `${rank}-${suit}`;
}

export function newDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit, id: cardId(rank, suit) });
  }
  return deck;
}

export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Fuerza de la carta para ganar bazas. Mayor gana; iguales = parda. */
export function power(card) {
  return SPECIAL_POWER[card.id] ?? GENERIC_POWER[card.rank];
}

/** Valor de la carta para el tanto (envido): figuras valen 0. */
export function envidoValue(card) {
  return card.rank >= 10 ? 0 : card.rank;
}

/**
 * Tanto de una mano de 3 cartas, junto con QUÉ cartas lo forman.
 * Hace falta saberlo para el "pacto": al final sólo se muestran las cartas
 * que justifican el tanto, nunca la mano entera.
 * @returns {{value:number, indices:number[]}} índices dentro de `cards`
 */
export function envidoBreakdown(cards) {
  const bySuit = new Map();
  cards.forEach((c, i) => {
    if (!bySuit.has(c.suit)) bySuit.set(c.suit, []);
    bySuit.get(c.suit).push(i);
  });

  let best = { value: -1, indices: [] };
  for (const idxs of bySuit.values()) {
    const sorted = idxs.slice().sort((a, b) => envidoValue(cards[b]) - envidoValue(cards[a]));
    const candidate =
      sorted.length >= 2
        ? {
            value: envidoValue(cards[sorted[0]]) + envidoValue(cards[sorted[1]]) + 20,
            indices: [sorted[0], sorted[1]],
          }
        : { value: envidoValue(cards[sorted[0]]), indices: [sorted[0]] };
    if (candidate.value > best.value) best = candidate;
  }
  return best;
}

/** Tanto de una mano de 3 cartas. */
export function envidoOf(cards) {
  return envidoBreakdown(cards).value;
}

export function cardLabel(card) {
  const name = FIGURE_LABEL[card.rank] ?? String(card.rank);
  return `${name} de ${card.suit}`;
}
