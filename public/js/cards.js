// Cartas del mazo español clásico.
// Los naipes viven en /cards/{palo}-{número}.webp — ver public/cards/CREDITOS.md.

const FIGURES = { 10: 'Sota', 11: 'Caballo', 12: 'Rey' };

export function cardName(card) {
  return `${FIGURES[card.rank] ?? card.rank} de ${card.suit}`;
}

export function cardSrc(card) {
  return `/cards/${card.suit}-${card.rank}.webp`;
}

/**
 * @param {{rank:number,suit:string}|null} card  null / undefined => dorso
 * @param {{size?:string, playable?:boolean, index?:number, ghost?:boolean}} opts
 */
export function cardHtml(card, opts = {}) {
  const { size = 'md', playable = false, index = null, ghost = false } = opts;
  const classes = ['card', `card--${size}`];

  if (ghost) return `<div class="card card--${size} is-ghost" aria-hidden="true"></div>`;

  if (!card) {
    classes.push('card--back');
    return `<div class="${classes.join(' ')}" aria-label="Carta tapada"></div>`;
  }

  if (playable) classes.push('is-playable');

  const attrs = [
    `class="${classes.join(' ')}"`,
    `data-suit="${card.suit}"`,
    `data-rank="${card.rank}"`,
  ];
  if (playable && index !== null) {
    attrs.push('role="button"', 'tabindex="0"', `data-play="${index}"`);
  }

  return `<div ${attrs.join(' ')}>
    <img src="${cardSrc(card)}" alt="${cardName(card)}" draggable="false" decoding="async">
  </div>`;
}

/** Trae las cartas de una mano al caché del navegador antes de que se necesiten. */
export function preload(cards) {
  for (const card of cards) {
    if (!card) continue;
    const img = new Image();
    img.src = cardSrc(card);
  }
}
