/*
 * Wikiloc Route Helper - background script
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

const STORAGE_KEY = "enabled";

async function isEnabled() {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return Boolean(stored[STORAGE_KEY]);
}

async function updateBadge(enabled) {
  await browser.action.setBadgeText({ text: enabled ? "ON" : "" });
  await browser.action.setBadgeBackgroundColor({ color: "#2e7d32" });
}

browser.action.onClicked.addListener(async () => {
  const enabled = !(await isEnabled());
  await browser.storage.local.set({ [STORAGE_KEY]: enabled });
  await updateBadge(enabled);
});

// Restaura el estado del badge al iniciar el navegador o recargar la extensión.
isEnabled().then(updateBadge);
