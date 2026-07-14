/*
 * Wikiloc Route Helper - content script
 * Copyright (C) 2026  Ángel Cardiel
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * Este script solo modifica la presentación de la página en el navegador
 * del usuario. No extrae, almacena ni reenvía datos de Wikiloc: se limita
 * a pulsar los botones "Muestra en el mapa" que ya ofrece la propia web y
 * a recolorear los trazados SVG que esta dibuja. Las geometrías se piden
 * de una en una y con un retardo de cortesía entre peticiones.
 */

const STORAGE_KEY = "enabled";
const MODE_KEY = "mapMode"; // "off" | "hover" | "manual" | "colors"
const HIDE_WPTS_KEY = "hideWaypoints";
const ROOT_CLASS = "wlx-enabled";
const HIDE_WPTS_CLASS = "wlx-hide-wpts";

const IS_MAP_PAGE = location.pathname.startsWith("/wikiloc/map.do");

// Selectores del DOM que genera Vue en la página de búsqueda de Wikiloc.
const CARD_SELECTOR = ".trail";
const EYE_SELECTOR = ".trail-card__show-on-map, .trail-list__show-on-map";
const OVERLAY_PANE_SELECTOR = ".leaflet-overlay-pane";

// Color con el que L.WklPolyline dibuja todos los trazados por defecto.
const DEFAULT_STROKE = "#ff9933";

// Paleta de colores bien diferenciables entre sí y visibles sobre satélite.
const PALETTE = [
  "#e6194b", "#f58231", "#ffe119", "#3cb44b", "#42d4f4", "#4363d8",
  "#911eb4", "#f032e6", "#800000", "#9a6324", "#808000", "#469990",
];

// Pausa de cortesía entre peticiones de geometría al activar "Todos en
// color". Se le suma una variación aleatoria para suavizar la carga y no
// generar ráfagas a intervalos exactos.
const REQUEST_DELAY_MS = 200;
const REQUEST_JITTER_MS = 300;

let extensionEnabled = false;
let mode = "off";
let hideWaypoints = false;
let panel = null;

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "manual" y "colors" comparten toda la maquinaria de coloreado; solo
// cambia quién pulsa los ojos: el usuario o la propia extensión.
function isTrackingMode(m) {
  return m === "manual" || m === "colors";
}

function eyeOf(card) {
  return card.querySelector(EYE_SELECTOR);
}

// El icono del ojo cambia de outlined_eye.svg a filled_eye.svg cuando el
// trazado está visible en el mapa.
function isEyeOn(eye) {
  const img = eye.querySelector("img");
  return img !== null && img.src.includes("filled_eye");
}

function waitForElement(selector, timeoutMs) {
  return new Promise((resolve) => {
    const found = document.querySelector(selector);
    if (found) {
      resolve(found);
      return;
    }
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

/* ------------------------------------------------------------------ */
/* Resaltado bidireccional ficha <-> trazado (modo colores)            */
/* ------------------------------------------------------------------ */

// Ficha -> paths SVG de su trazado. Se rellena al colorear cada trazado.
const cardPaths = new Map();

function setPairHighlight(card, on) {
  card.classList.toggle("wlx-card-highlight", on);
  for (const path of cardPaths.get(card) || []) {
    if (!path.isConnected) continue;
    path.classList.toggle("wlx-trace-highlight", on);
    // Igual que hace bringToFront() de Leaflet: el último path del grupo
    // se pinta encima, útil cuando hay solapamientos.
    if (on) path.parentNode.appendChild(path);
  }
}

function attachTraceHover(paths, card) {
  for (const path of paths) {
    path.addEventListener("mouseenter", () => {
      if (!isTrackingMode(mode)) return;
      setPairHighlight(card, true);
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    path.addEventListener("mouseleave", () => {
      if (!isTrackingMode(mode)) return;
      setPairHighlight(card, false);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Modo hover: mostrar el trazado al pasar el ratón por la ficha       */
/* ------------------------------------------------------------------ */

const HOVER_DELAY_MS = 150;
let hoverTimer = null;

function cardFromEventTarget(target) {
  return target instanceof Element ? target.closest(CARD_SELECTOR) : null;
}

function onMouseOver(event) {
  if (!extensionEnabled) return;
  const card = cardFromEventTarget(event.target);
  if (!card || card === cardFromEventTarget(event.relatedTarget)) return;

  if (mode === "hover") {
    // Pequeño retardo para no disparar peticiones al atravesar la lista.
    hoverTimer = setTimeout(() => {
      const eye = eyeOf(card);
      // Si el usuario ya lo tenía fijado (ojo relleno), no lo tocamos.
      if (eye && !isEyeOn(eye)) {
        eye.click();
        card.dataset.wlxHoverShown = "1";
      }
    }, HOVER_DELAY_MS);
  } else if (isTrackingMode(mode) && cardPaths.has(card)) {
    setPairHighlight(card, true);
  }
}

function onMouseOut(event) {
  const card = cardFromEventTarget(event.target);
  if (!card || card === cardFromEventTarget(event.relatedTarget)) return;

  if (mode === "hover") {
    clearTimeout(hoverTimer);
    if (card.dataset.wlxHoverShown) {
      delete card.dataset.wlxHoverShown;
      const eye = eyeOf(card);
      if (eye && isEyeOn(eye)) {
        eye.click();
      }
    }
  } else if (isTrackingMode(mode)) {
    setPairHighlight(card, false);
  }
}

/* ------------------------------------------------------------------ */
/* Modo colores: mostrar todos los trazados, cada uno de un color      */
/* ------------------------------------------------------------------ */

let recolorObserver = null;
let colorIndex = 0;
let colorsRun = 0; // invalida un recorrido en curso al cambiar de modo
let pendingTraceResolve = null;

// Cola de fichas cuyo trazado está a punto de aparecer en el mapa. La
// rellena el listener de clics del ojo (tanto los nuestros como los del
// usuario) y la consume el observer al llegar cada geometría: así cada
// trazado queda asociado a su ficha y conserva siempre el mismo color.
const pendingCards = [];
const PENDING_MAX_AGE_MS = 10000;

function nextColor() {
  const color = PALETTE[colorIndex % PALETTE.length];
  colorIndex += 1;
  return color;
}

function paintPaths(paths, color) {
  for (const path of paths) {
    path.setAttribute("stroke", color);
    path.setAttribute("data-wlx-colored", color);
  }
}

// Vue detiene la propagación del clic en el ojo (@click.stop), así que
// este listener debe ir en fase de captura para enterarse de todos.
function onEyeClickCapture(event) {
  if (!isTrackingMode(mode)) return;
  const eye = event.target instanceof Element && event.target.closest(EYE_SELECTOR);
  if (!eye) return;
  const card = eye.closest(CARD_SELECTOR);
  if (!card) return;

  if (isEyeOn(eye)) {
    // Se va a ocultar el trazado: retira la franja pero conserva el color
    // asignado (data-wlx-color) para reutilizarlo si se vuelve a mostrar.
    card.classList.remove("wlx-trace-tag");
    setPairHighlight(card, false);
    cardPaths.delete(card);
  } else {
    pendingCards.push({ card, time: Date.now() });
  }
}

function takePendingCard() {
  const now = Date.now();
  while (pendingCards.length > 0) {
    const entry = pendingCards.shift();
    if (now - entry.time <= PENDING_MAX_AGE_MS) {
      return entry.card;
    }
  }
  return null;
}

function removePendingCard(card) {
  const index = pendingCards.findIndex((entry) => entry.card === card);
  if (index !== -1) {
    pendingCards.splice(index, 1);
  }
}

function collectNewTracePaths(mutations) {
  const paths = [];
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches("path[fill='none']:not([data-wlx-colored])")) {
        paths.push(node);
      }
      paths.push(...node.querySelectorAll("path[fill='none']:not([data-wlx-colored])"));
    }
  }
  return paths;
}

function startRecolorObserver(pane) {
  // Todos los paths añadidos en un mismo lote de mutaciones pertenecen al
  // mismo trazado (las geometrías se piden de una en una), así que
  // comparten color.
  recolorObserver = new MutationObserver((mutations) => {
    const paths = collectNewTracePaths(mutations);
    if (paths.length === 0) return;

    const card = takePendingCard();
    const color = (card && card.dataset.wlxColor) || nextColor();
    paintPaths(paths, color);

    if (card) {
      card.dataset.wlxColor = color;
      card.style.setProperty("--wlx-trace-color", color);
      card.classList.add("wlx-trace-tag");
      cardPaths.set(card, paths);
      attachTraceHover(paths, card);
    }

    if (pendingTraceResolve) {
      pendingTraceResolve(color);
      pendingTraceResolve = null;
    }
  });
  recolorObserver.observe(pane, { childList: true, subtree: true });
}

// Promesa que se resuelve cuando el observer procesa el próximo trazado,
// o con null si no llega a tiempo.
function waitForNextTrace(timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingTraceResolve = null;
      resolve(null);
    }, timeoutMs);
    pendingTraceResolve = (color) => {
      clearTimeout(timer);
      resolve(color);
    };
  });
}

// Activa el coloreado de trazados. Con autoShow, además muestra todas las
// fichas de la lista; sin él (modo manual) solo procesa las ya fijadas y
// deja que sea el usuario quien vaya pulsando "Muestra en el mapa".
async function enableColorTracking(autoShow) {
  const run = ++colorsRun;
  const pane = await waitForElement(OVERLAY_PANE_SELECTOR, 10000);
  if (!pane || run !== colorsRun) return;

  startRecolorObserver(pane);

  // Recorre las fichas una a una: se espera cada geometría y se añade un
  // retardo de cortesía para no saturar el servidor de Wikiloc.
  let consecutiveMisses = 0;
  for (const card of document.querySelectorAll(CARD_SELECTOR)) {
    if (run !== colorsRun) return;
    const eye = eyeOf(card);
    if (!eye) continue;

    // Las rutas que ya estuvieran fijadas a mano se ocultan y se vuelven a
    // mostrar para poder asociarlas a su ficha. La página tiene la
    // geometría en caché, así que esto no genera peticiones nuevas.
    const wasPinned = isEyeOn(eye);
    if (!wasPinned && !autoShow) continue;
    if (wasPinned) {
      eye.click();
      await sleep(100); // deja que Vue procese la retirada del trazado
      if (run !== colorsRun) return;
    }

    const tracePromise = waitForNextTrace(5000);
    eye.click();
    // Las fijadas por el usuario no se marcan: al desactivar el modo deben
    // quedarse en el mapa tal y como él las dejó.
    if (!wasPinned) card.dataset.wlxColorsShown = "1";
    const color = await tracePromise;
    if (run !== colorsRun) return;
    // Si la geometría no llegó, evita que el próximo trazado que aparezca
    // se atribuya a esta ficha.
    if (color) {
      consecutiveMisses = 0;
    } else {
      removePendingCard(card);
      // Si el servidor deja de responder, se aborta el barrido en lugar de
      // insistir: quien quiera puede reintentarlo desde el panel.
      consecutiveMisses += 1;
      if (consecutiveMisses >= 2) break;
    }
    if (!wasPinned) {
      await sleep(REQUEST_DELAY_MS + Math.random() * REQUEST_JITTER_MS);
    }
  }

  // Colorea los trazados huérfanos: rutas fijadas en otra búsqueda o página
  // cuya ficha ya no está en la lista (sin ficha no llevan franja).
  for (const path of pane.querySelectorAll("path[fill='none']:not([data-wlx-colored])")) {
    paintPaths([path], nextColor());
  }
}

function disableColorTracking() {
  colorsRun += 1;
  if (recolorObserver) {
    recolorObserver.disconnect();
    recolorObserver = null;
  }
  pendingTraceResolve = null;
  pendingCards.length = 0;
  cardPaths.clear();
  colorIndex = 0;

  // Oculta solo los trazados que activó este modo.
  for (const card of document.querySelectorAll("[data-wlx-colors-shown]")) {
    delete card.dataset.wlxColorsShown;
    const eye = eyeOf(card);
    if (eye && isEyeOn(eye)) {
      eye.click();
    }
  }

  // Limpia la marca de color de todas las fichas.
  for (const card of document.querySelectorAll("[data-wlx-color]")) {
    delete card.dataset.wlxColor;
    card.classList.remove("wlx-trace-tag", "wlx-card-highlight");
    card.style.removeProperty("--wlx-trace-color");
  }

  // Devuelve su color original a los trazados que sigan en el mapa.
  for (const path of document.querySelectorAll("path[data-wlx-colored]")) {
    path.setAttribute("stroke", DEFAULT_STROKE);
    path.removeAttribute("data-wlx-colored");
    path.classList.remove("wlx-trace-highlight");
  }
}

/* ------------------------------------------------------------------ */
/* Panel de control y gestión de modos                                 */
/* ------------------------------------------------------------------ */

// La ocultación de waypoints solo tiene sentido con varios trazados a la
// vez, así que va ligada a los modos de coloreado.
function updateWaypointVisibility() {
  const active = isTrackingMode(mode) && hideWaypoints;
  document.documentElement.classList.toggle(HIDE_WPTS_CLASS, active);
  if (panel) {
    panel.querySelector(".wlx-panel__wpts").hidden = !isTrackingMode(mode);
  }
}

function setMode(newMode, persist = true) {
  if (newMode === mode) return;

  if (isTrackingMode(mode)) {
    disableColorTracking();
  }
  clearTimeout(hoverTimer);

  mode = newMode;
  if (isTrackingMode(mode)) {
    enableColorTracking(mode === "colors");
  }

  if (panel) {
    for (const button of panel.querySelectorAll("[data-mode]")) {
      button.classList.toggle("wlx-panel__btn--active", button.dataset.mode === mode);
    }
  }
  updateWaypointVisibility();
  if (persist) {
    browser.storage.local.set({ [MODE_KEY]: mode });
  }
}

function buildPanel() {
  panel = document.createElement("div");
  panel.className = "wlx-panel";
  panel.innerHTML = `
    <span class="wlx-panel__title">Trazados</span>
    <button type="button" class="wlx-panel__btn" data-mode="hover"
            title="Muestra el trazado de la ruta al pasar el ratón por su ficha">
      Al pasar el ratón
    </button>
    <button type="button" class="wlx-panel__btn" data-mode="manual"
            title="Colorea los trazados que tú vayas mostrando con «Muestra en el mapa»">
      Al marcar
    </button>
    <button type="button" class="wlx-panel__btn" data-mode="colors"
            title="Muestra todos los trazados a la vez, cada uno de un color">
      Todos en color
    </button>
    <label class="wlx-panel__wpts" hidden
           title="Oculta los marcadores de waypoint para ver mejor los trazados">
      <input type="checkbox"> Ocultar waypoints
    </label>`;
  panel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (button) {
      setMode(mode === button.dataset.mode ? "off" : button.dataset.mode);
    }
  });
  const checkbox = panel.querySelector(".wlx-panel__wpts input");
  checkbox.checked = hideWaypoints;
  checkbox.addEventListener("change", () => {
    hideWaypoints = checkbox.checked;
    updateWaypointVisibility();
    browser.storage.local.set({ [HIDE_WPTS_KEY]: hideWaypoints });
  });
  document.body.appendChild(panel);
}

async function applyState(enabled) {
  extensionEnabled = enabled;
  document.documentElement.classList.toggle(ROOT_CLASS, enabled);
  if (!IS_MAP_PAGE) return;

  if (enabled) {
    const stored = await browser.storage.local.get([MODE_KEY, HIDE_WPTS_KEY]);
    hideWaypoints = Boolean(stored[HIDE_WPTS_KEY]);
    if (!panel) buildPanel();
    panel.hidden = false;
    panel.querySelector(".wlx-panel__wpts input").checked = hideWaypoints;
    let savedMode = stored[MODE_KEY];
    // "Todos en color" no se restaura nunca automáticamente: dispararía
    // peticiones de geometría sin una acción explícita del usuario en cada
    // página. Se degrada al modo manual, que es inerte hasta que el
    // usuario pulsa algo.
    if (savedMode === "colors") savedMode = "manual";
    if (savedMode === "hover" || savedMode === "manual") {
      // Espera a que Vue haya pintado la lista antes de restaurar el modo.
      await waitForElement(CARD_SELECTOR, 10000);
      setMode(savedMode, true);
    }
  } else {
    setMode("off", false);
    if (panel) panel.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

document.addEventListener("mouseover", onMouseOver);
document.addEventListener("mouseout", onMouseOut);
document.addEventListener("click", onEyeClickCapture, true);

browser.storage.local
  .get(STORAGE_KEY)
  .then((stored) => applyState(Boolean(stored[STORAGE_KEY])));

// Reacciona al botón de la barra de herramientas sin recargar la página.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY in changes) {
    applyState(Boolean(changes[STORAGE_KEY].newValue));
  }
});
