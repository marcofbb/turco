# 🃏 Turco

**Truco argentino de a tres, online, desde el celular. Dos juegan, uno mira.**

Turco es una variante del truco con cartas españolas donde se juega de a tres: dos en la
mesa y un tercero que mira. El envido se canta **a ciegas** —nadie dice su tanto hasta
que termina la ronda—, la ronda la gana quien más puntos suma, y los empates alimentan un
pozo que se va agrandando hasta que alguien lo corta.

PWA instalable, mobile-first, **sin una sola dependencia de npm**.

---

## Jugar

```bash
node server/index.js
```

Abrí `http://localhost:3000`. El servidor imprime también la IP de tu red, para que los
demás entren desde el celular estando en el mismo wifi.

Uno crea la sala, comparte el código de 4 letras, y cuando entran los tres arranca solo.

> [!NOTE]
> **Esto no funciona en GitHub Pages.** Turco necesita un servidor Node con WebSockets:
> ahí vive el motor de reglas y, sobre todo, la privacidad de las cartas. Pages sólo sirve
> archivos estáticos. Para jugarlo online, mirá [Deploy](#deploy).

---

## Las reglas

Es truco con cartas españolas, **sin flor**, pero cambia bastante.

### La mesa

1. **Sorteo de apertura.** Se da una carta a cada uno: juegan las dos más altas y la más
   baja mira. La carta más alta arranca de mano. Si hay empate, se vuelve a dar.
2. **El ganador se queda** y entra el que estaba mirando; el perdedor pasa a mirar.
3. El ganador arranca siendo **mano**.

### El envido es a ciegas

Esta es la regla que le da carácter al juego.

- Cantás envido **sin decir el tanto**. El otro responde quiero o no quiero sin saber
  contra qué juega.
- Los tantos se revelan **recién al terminar la ronda**.

| Canto                     | Querido | No querido |
| ------------------------- | :-----: | :--------: |
| Envido                    |    2    |     1      |
| Envido + Envido           |    4    |     2      |
| Real Envido               |    3    |     1      |
| Envido + Real Envido      |    5    |     2      |
| Envido + Envido + Real    |    7    |     4      |
| Falta Envido              |    4    |  lo acumulado  |

*Falta Envido vale 4 a propósito: empata con Vale Cuatro, y así el mecanismo del pozo
sigue vivo.*

### Quién gana la ronda

- Se **suman los puntos de la ronda** (envido + truco). El que más suma, gana.
- Ganar la ronda vale **1 punto** en la general.

### El pozo

- Si empatan en puntos, **se vuelve a dar entre esos mismos dos** y queda 1 punto en el pozo.
- Cada empate suma 1 al pozo, hasta un máximo de **5**.
- El que corta la racha **se lleva todo el pozo**. En las redadas la mano alterna.

### Pacto

Al terminar la ronda **no se muestra la mano entera**:

- Se ven **las cartas que se jugaron**, en el orden en que se tiraron.
- Si el envido fue querido, se ven además **las cartas que forman cada tanto** — son las
  que justifican los puntos.
- Si no se jugó ninguna carta ni se quiso el envido, no se ve nada. Eso es **pacto**.

### Mostrar los tantos

Si el envido se quiso, cualquiera de los dos puede cortar la mano ahí mismo con
**Mostrar tantos**: le regala el truco al otro y la ronda se define por el envido.

Sirve cuando confiás en tu tanto y no te interesa jugar el truco. Aparece también como
respuesta a un canto: *"No quiero, muestro los tantos"*.

### El que mira

- De entrada **no ve ninguna mano**: sólo lo que está sobre la mesa.
- Puede **pedirle permiso** a cada jugador para ver sus cartas. El dueño decide.
- El permiso vale **sólo por esa ronda**.

### Modo tele 📺

Cada sala genera un **segundo código** para poner la partida en una pantalla grande.

Con ese código se ve la mesa, quién está jugando y los puntajes — pero **nunca las
manos**, ni siquiera si alguien dio permiso. Pueden entrar varias teles a la vez.

### Ganar

- Primero a **15 puntos**.
- Si llegás a 15 **sin haber perdido nunca** una ronda, te llevás el trofeo
  **MAGISTRAL** 🏆.

### Jerarquía de las cartas

De mayor a menor: **1 de espada · 1 de basto · 7 de espada · 7 de oro**, después los 3,
los 2, los 1 falsos (oro y copa), reyes (12), caballos (11), sotas (10), los 7 falsos
(copa y basto), y por último 6, 5 y 4.

Para el tanto: figuras (10, 11, 12) valen 0. Dos cartas del mismo palo suman sus valores
+ 20.

---

## Deploy

Turco necesita un host que ejecute Node y soporte WebSockets. **GitHub Pages no sirve.**

### Render (gratis)

El repo ya trae [`render.yaml`](render.yaml):

1. Entrá a [render.com](https://render.com) y conectá tu cuenta de GitHub.
2. **New → Blueprint** y elegí este repositorio.
3. Render lee `render.yaml` y deploya solo. En un par de minutos tenés una URL HTTPS
   pública con WebSockets funcionando.

En el plan gratis la app se duerme a los 15 minutos sin uso y tarda unos 30 segundos en
despertar. Para jugar con amigos alcanza de sobra.

### Cualquier otro host

Sirve cualquiera que corra Node ≥ 18 y deje pasar WebSockets: Railway, Fly.io, Koyeb, un
VPS. El servidor respeta `process.env.PORT` y expone `/health` para el health check.

```bash
PORT=8080 node server/index.js
```

---

## Cómo está hecho

Cero dependencias de npm. Todo corre con Node ≥ 18.

```
server/
  index.js    HTTP de estáticos + WebSocket
  ws.js       WebSocket mínimo (RFC 6455) implementado a mano
  rooms.js    salas, códigos, reconexión, modo tele
  game.js     el motor de reglas — toda la lógica vive acá
  deck.js     mazo español, jerarquía y tanto
public/
  index.html · css/styles.css · js/{app,cards,sound}.js
  cards/      las 40 cartas en WebP
  sw.js       service worker · manifest.webmanifest
test/
  engine.test.js   61 pruebas del motor (reglas, privacidad, simulación)
  privacy.e2e.js   15 pruebas de privacidad contra el servidor real
  partida.e2e.js   20 pruebas de partida completa, reconexión y revancha
scripts/
  make-icons.js    genera los PNG del PWA sin librerías de imagen
```

### Decisiones que vale la pena conocer

**El servidor es la única fuente de verdad.** El cliente nunca recibe una carta que no
tenga derecho a ver: el filtrado pasa en `viewFor()` y `outcomeFor()`, no en la UI. Por
eso el pacto y los permisos son garantías reales y no un maquillaje — no alcanza con
abrir el DevTools.

**El sonido es sintetizado** con Web Audio, sin archivos de audio. Los cantos además se
"gritan" con la voz del sistema. El botón 🔊 cicla entre sonido+voz, sólo efectos y mudo.

**El service worker usa red primero para el código.** El juego necesita servidor igual,
así que cachear el JS sólo lograba desincronizar el cliente del motor. Las cartas sí van
cache primero: nunca cambian.

> [!WARNING]
> Si tocás algo en `server/`, **reiniciá el proceso**. Node no recarga solo, y un cliente
> nuevo hablando con un motor viejo produce bugs muy confusos.

### Tests

```bash
npm test          # motor de reglas, sin servidor
npm run test:e2e  # end-to-end (necesita el servidor corriendo)
```

96 pruebas en total. Las del motor incluyen 200 partidas completas jugadas al azar,
verificando en cada cierre de ronda que no se filtre ninguna carta que no corresponda.

---

## Licencia

El **código** está bajo [MIT](LICENSE).

Las **imágenes de las cartas** (`public/cards/`) derivan de obra de terceros y van bajo
**CC BY-SA 3.0** — atribución y detalle de los cambios en
[`public/cards/CREDITOS.md`](public/cards/CREDITOS.md). Al ser ShareAlike, esas imágenes y
sus derivados deben seguir distribuyéndose bajo la misma licencia.
