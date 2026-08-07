# Naipes españoles — atribución

Las 40 cartas de esta carpeta (`{palo}-{número}.webp`) derivan de:

**Spanish Playing Cards SVG** — https://github.com/gjenkins20/spanish-playing-cards-svg
Basado a su vez en la obra de **Basquetteur** publicada en Wikimedia Commons.

**Licencia:** Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)
https://creativecommons.org/licenses/by-sa/3.0/

## Cambios realizados

Respecto del original:

1. Se tomaron sólo las 40 cartas del mazo español de truco (1–7, 10, 11 y 12 de cada palo);
   se descartaron los 8 y los 9.
2. Se redujo la precisión decimal de los trazados vectoriales para achicar los archivos.
3. Se rasterizaron a WebP de 300 × 462 px (calidad 0,9), que es el tamaño al que se
   muestran en pantalla. El mazo entero pasó de 58 MB a menos de 1 MB.
4. Se renombraron los archivos al esquema `{palo}-{número}.webp` en español.

El dorso de las cartas **no** proviene de esta fuente: está dibujado con CSS en
`public/css/styles.css` (regla `.card--back`).

Como la licencia es ShareAlike, estas imágenes y cualquier obra derivada de ellas
deben seguir distribuyéndose bajo CC BY-SA 3.0.
