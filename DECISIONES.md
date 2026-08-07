# Decisiones de reglas y mejoras pendientes

Documento vivo. Guarda **qué se decidió y por qué**, y **qué falta decidir**, para no
volver a discutir lo mismo dentro de seis meses.

Los números de balance salen de [`scripts/balance.js`](scripts/balance.js), que simula
partidas con bots que juegan con criterio. Para volver a medir:

```bash
node scripts/balance.js 3000
```

> [!IMPORTANT]
> Los bots usan umbrales fijos, así que **no son humanos**. Los porcentajes marcan
> dirección y orden de magnitud, no verdad absoluta. Sirven para comparar *antes y
> después* de un cambio, que es para lo que están.

---

## 1. Decisiones tomadas

### 1.1 Las que se consultaron

| Decisión | Opciones sobre la mesa | Elegida | Razón |
|---|---|---|---|
| **Falta Envido** | 4 · 7 · lo que le falta al líder para 15 | **4** | Empata con Vale Cuatro, así siguen existiendo empates y el pozo no muere |
| **Flor** | Sin flor · con flor | **Sin flor** | La flor obliga a cantar el tanto en el momento, y eso rompe el envido a ciegas |
| **Quién es mano** | El que entra · el ganador · alterna siempre | **El ganador**; en las redadas por pozo alterna | Decidido por preferencia del autor |
| **Cartas** | Bajar un set libre · dibujarlas a mano · muestra previa | **Set libre (CC BY-SA 3.0)** | Las figuras ilustradas no se replican a mano de forma realista |

### 1.2 Truco estándar, sin invención

Se aplicaron tal cual son en el truco argentino. No hay decisión de diseño acá:

- Valores del envido: 2 / 4 / 3 / 5 / 7 según la escalera.
- El "no quiero" paga lo que valía antes del último canto, con mínimo 1.
- El envido se puede repetir una sola vez (`Envido Envido`); después sólo Real o Falta.
- Truco 2/3/4 querido, 1/2/3 no querido.
- Sólo quien aceptó el truco puede subirlo.
- **El envido va primero**: con un truco pendiente en la primera baza, se puede cantar
  envido y se resuelve antes.
- El envido sólo hasta que se completa la primera baza.
- Pardas resueltas al modo clásico (parda en la primera → gana la segunda; tres pardas →
  gana el mano).
- Empate de tantos en el envido: gana el mano.

### 1.3 Decisiones de diseño propias

Acá sí se eligió entre alternativas razonables. Todas son discutibles:

1. **El pozo lo cobra entero el ganador**, no pozo + 1. Lectura literal de la regla
   original. → *ver [F](#-f-el-pozo-no-paga-en-el-80-de-los-casos) : esto tiene un efecto
   secundario importante.*
2. **Empatar no cuenta como perder** para el Magistral.
3. **El que arranca de espectador no "perdió"**, así que puede sacar Magistral.
4. **Irse al mazo**: el rival cobra el truco al valor del momento. Un envido pendiente
   cuenta como no querido; uno ya querido igual se resuelve por tantos.
5. **En el sorteo, si hay empate se vuelve a dar a los tres**, no sólo a los empatados.
   Más simple de mostrar y de razonar.
6. **La carta más alta del sorteo es mano.**
7. **El permiso para mirar dura sólo esa ronda**, y un "no" bloquea volver a pedir en esa
   misma ronda (para que no se pueda insistir).
8. **Pedir y dar permiso no consume turno**: va por fuera de la mano.
9. ~~**La tele nunca ve manos**, ni aunque un jugador haya dado permiso.~~
   **Revertido.** Ahora la tele puede pedir permiso a cada jugador por separado, y el que
   acepta le muestra sus cartas por el resto de la partida (vive en la sala, así que
   sobrevive a las revanchas). Un "no" se puede reintentar en la ronda siguiente.
   *Consecuencia asumida:* el código de tele pasa a ser una llave de "ver esas manos" que
   no caduca ni se puede revocar, y la comparten todas las pantallas conectadas.
10. **"Mostrar tantos" es mecánicamente idéntico a irse al mazo** (le regala el truco al
    rival al valor actual), sólo que el envido se resuelve por tanto.

---

## 2. Cómo se comporta el juego hoy

Medición sobre **3.000 partidas / 115.927 rondas**:

```
Rondas por partida        39,6   (mediana 40)
Rondas empatadas (pozo)   20,5%
Rondas en pacto            4,2%   (no se jugó ninguna carta)
Se cantó envido           53,2%
...y fue querido          14,0%
Se mostraron los tantos     0,5%

El envido dio vuelta las bazas   24,3%
Ganó el mano                     55,4%
El que se quedó revalidó         53,5%
Racha media en la mesa            2,1 rondas
Partidas con MAGISTRAL            0,0%
```

Pozo alcanzado en los 23.740 empates:

| Pozo | Empates | % |
|---:|---:|---:|
| 1 | 18.982 | 80,0% |
| 2 | 3.783 | 15,9% |
| 3 | 771 | 3,2% |
| 4 | 150 | 0,6% |
| 5 | 54 | 0,2% |

---

## 3. Mejoras pendientes

Ordenadas por prioridad. Ninguna está implementada.

### 🔴 A. Estancamiento: dos jugadores pueden congelar la partida

**Es un agujero, no un desbalance.** Verificado: 301 rondas, 0 puntos para todos, el
tercer jugador nunca entra.

Receta: el mano canta envido → el pie no quiere (+1 al mano) → el mano juega una carta →
el pie canta truco → el mano no quiere (+1 al pie). Empate 1-1, se redan cartas, y así
para siempre. El pozo se clava en 5.

Requiere cooperación de los dos, así que no es un exploit competitivo — pero sí una vía
de *griefing* contra el tercero.

> **Arreglo propuesto:** cuando el pozo llega al tope, el empate se rompe. Gana quien se
> llevó las bazas; si no se jugó ninguna carta, gana el mano. Garantiza que la partida
> siempre avanza.

### 🟠 B. El envido a ciegas casi no se quiere

Se canta en el 53% de las rondas pero **sólo el 14% termina con el envido querido**. La
mecánica insignia del juego se resuelve por tanto 1 de cada 7 rondas.

Causa: aceptar a ciegas da miedo, y con totales de ronda tan chicos (1 a 4) el punto del
"no quiero" ya alcanza para empatar o ganar. Rechazar es matemáticamente cómodo.

> **Arreglos posibles**, de menos a más invasivo:
> 1. El envido no querido paga **2** en vez de 1.
> 2. Quien gana un envido querido suma **1 punto extra** en esa ronda.
> 3. **Ganar las bazas vale mínimo 2.** Un no-quiero de 1 deja de empatar contra el juego
>    de cartas.
>
> La **3** es la recomendada: arregla esto y de paso mata el estancamiento de [A](#-a-estancamiento-dos-jugadores-pueden-congelar-la-partida).

### 🟠 C. La partida es larguísima

**39,6 rondas de promedio.** A dos minutos por ronda son 40-80 minutos, con un quinto de
rondas que no reparten ningún punto.

> **Arreglo:** bajar el objetivo a **9 o 12 puntos** (`TARGET` en `server/game.js`). Con 9
> quedaría en ~24 rondas.

### 🟡 D. El Magistral es inalcanzable

**0 en 3.000 partidas.** Un trofeo que nunca sale es decorado, no objetivo.

Causa raíz: la duración. Para llegar a 15 sin perder nunca hay que ganar ~13 rondas
seguidas rotando contra dos rivales.

> **Arreglo:** acortar la partida ([C](#-c-la-partida-es-larguísima)) ya lo vuelve
> alcanzable. Si se mantiene el 15, agregar un escalón intermedio: **"Impecable"** para
> quien gana habiendo perdido una sola vez.

### 🟡 E. Falta Envido perdió su función de remontada

En el truco de verdad el Falta Envido es *la* mecánica de comeback: vale lo que le falta
al líder. Acá vale 4 fijo, lo mismo que Vale Cuatro y que Envido+Envido. **Un jugador con
2 puntos y uno con 14 tienen el mismo Falta.** El juego se quedó sin banda elástica.

> **Arreglo que no toca la aritmética de la ronda:** la ronda ganada con Falta Envido
> querido vale **2 puntos** en la general en vez de 1.

### 🟡 F. El pozo no paga en el 80% de los casos

**Decisión abierta, pendiente de definir.**

Hoy el ganador cobra `max(1, pozo)`:

| Pozo | Suma |
|---:|:---|
| 0 | +1 |
| 1 | **+1** ← igual que sin pozo |
| 2 | +2 |
| … | … |
| 5 | +5 |

Como el pozo se carga de a uno, **el primer empate lo deja en 1 y no vale nada**. Y el 80%
de los empates se quedan ahí. Empataron, jugaron una ronda entera de más, y el ganador
cobró exactamente lo mismo que sin todo eso. Llegar a 5 pasa en el 0,2% de los empates.

Es fiel al texto original de la regla, pero el efecto práctico es que el castigo por
empatar existe sólo 1 de cada 5 veces.

> **Opciones:**
> 1. **El pozo se suma al punto de la ronda**: ganás `1 + pozo`. El primer empate ya hace
>    que la próxima ronda valga 2; el tope de 5 pagaría 6. Es la que más cambia el juego y
>    la que más se parece a la intención de "escalada".
> 2. **El pozo arranca en 2**: el primer empate deja 2 en juego, el resto igual. Más
>    conservadora, respeta el tope de 5.
>
> Está en una línea: `server/game.js`, `awarded = Math.max(1, match.pot)`.

### 🟢 G. El espectador no hace nada

Un tercio de los jugadores está inactivo cada ronda (~13 rondas por partida). Pedir
permiso para mirar es lindo pero no es agencia.

> **Arreglo barato:** antes de que arranque la ronda, el que mira predice en secreto quién
> gana. Si acierta, entra de mano en su próxima ronda. No toca la economía de puntos.

### ⚪ H. Ventaja de mano: medida, no tocar

El mano gana el **55,4%** de las rondas y el que se queda revalida el **53,5%**. Se
acumulan (el ganador se queda *y* es mano), pero no es opresivo y la racha media es de 2,1
rondas: rota bien.

Queda documentado sólo para que se sepa que la ventaja existe y es medible. **No hace
falta cambiar nada.**

---

## 4. Antes de tocar cualquier regla

1. Correr `node scripts/balance.js 3000` y guardar los números de referencia.
2. Hacer el cambio.
3. Volver a correr y comparar.
4. Correr `npm test` — hay 61 pruebas de motor que cubren las reglas actuales; varias van
   a fallar a propósito si cambiás una regla, y hay que actualizarlas *a conciencia*, no
   para que pasen.
