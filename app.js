import { convertLevel, createGeneratedLevel, createGdServerLevel, outputFilename, parseLevelFile } from "./level-format.js";

const tabButtons = Array.from(document.querySelectorAll(".tab"));
const panels = Array.from(document.querySelectorAll(".panel"));
const directionButtons = Array.from(document.querySelectorAll(".direction-option"));
const translateInput = document.querySelector("#translate-input");
const translateDrop = document.querySelector("#translate-drop");
const translateTitle = document.querySelector("#translate-title");
const translateResult = document.querySelector("#translate-result");
const libraryInput = document.querySelector("#library-input");
const libraryDrop = document.querySelector("#library-drop");
const libraryList = document.querySelector("#library-list");
const libraryStatus = document.querySelector("#library-status");
const generateForm = document.querySelector("#generate-form");
const generateButton = document.querySelector("#generate-button");
const generateStatus = document.querySelector("#generate-status");
const generatedResult = document.querySelector("#generated-result");
const serverSearch = document.querySelector("#server-search");
const serverUrl = document.querySelector("#server-url");
const serverQuery = document.querySelector("#server-query");
const serverSearchButton = document.querySelector("#server-search-button");
const serverStatus = document.querySelector("#server-status");
const serverResults = document.querySelector("#server-results");
let direction = "gmd";
let translationUrl;
let library = [];
let generatedLevel;
const aiProfileFocus = {
  builder: "Prioritize a complete, playable route with clear pacing, readable jumps, varied but fair hazards, and satisfying difficulty progression.",
  visual: "Prioritize a memorable visual identity through a cohesive palette and repeated decoration motifs while keeping gameplay readable and fully playable.",
  rhythm: "Prioritize beat-led gameplay patterns, syncopated obstacle spacing, repeated motifs, and clean transitions between musical phrases while keeping the route fully playable."
};
const serverLevelCache = new Map();

function selectTab(name) {
  for (const button of tabButtons) {
    const active = button.dataset.tab === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of panels) {
    const active = panel.id === "panel-" + name;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  }
}

tabButtons.forEach(button => button.addEventListener("click", () => selectTab(button.dataset.tab)));
document.querySelector(".tabs").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = tabButtons.findIndex(button => button.getAttribute("aria-selected") === "true");
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabButtons.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabButtons.length) % tabButtons.length;
  tabButtons[next].focus();
  selectTab(tabButtons[next].dataset.tab);
});

function clearTranslation() {
  if (translationUrl) URL.revokeObjectURL(translationUrl);
  translationUrl = undefined;
  translateResult.hidden = true;
  translateResult.replaceChildren();
}

function setDirection(source) {
  direction = source;
  directionButtons.forEach(button => {
    const active = button.dataset.source === source;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const inputExt = source === "gmd" ? ".gmd" : ".gdlvl";
  translateInput.accept = inputExt + ",application/octet-stream";
  translateTitle.innerHTML = "Drop a <strong>" + inputExt + "</strong> level here";
  clearTranslation();
}

directionButtons.forEach(button => button.addEventListener("click", () => setDirection(button.dataset.source)));

function setupDropzone(zone, input, onFiles) {
  zone.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && event.target === zone) {
      event.preventDefault();
      input.click();
    }
  });
  for (const type of ["dragenter", "dragover"]) {
    zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.add("is-over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.remove("is-over");
    });
  }
  zone.addEventListener("drop", event => {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) onFiles(Array.from(event.dataTransfer.files));
  });
  input.addEventListener("change", () => {
    if (input.files?.length) onFiles(Array.from(input.files));
    input.value = "";
  });
}

setupDropzone(translateDrop, translateInput, files => translateFile(files[0]));
setupDropzone(libraryDrop, libraryInput, addLibraryFiles);

async function translateFile(file) {
  clearTranslation();
  translateResult.hidden = false;
  translateResult.setAttribute("aria-busy", "true");
  translateResult.textContent = "Reading and converting level…";
  try {
    const parsed = await parseLevelFile(file);
    if (parsed.format !== direction) {
      throw new Error("This tab is set to read ." + direction + " files. Switch the direction to match this file.");
    }
    const target = direction === "gmd" ? "gdlvl" : "gmd";
    const blob = await convertLevel(parsed, target);
    translationUrl = URL.createObjectURL(blob);
    const row = document.createElement("div");
    row.className = "result-row";
    const info = document.createElement("div");
    info.className = "file-info";
    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = parsed.name;
    const meta = document.createElement("div");
    meta.className = "file-meta";
    meta.append(document.createTextNode(parsed.objectCount.toLocaleString() + " objects · Song ID "));
    const songId = document.createElement("span");
    songId.className = "font-gold";
    songId.textContent = String(parsed.songId ?? "unavailable");
    meta.append(songId, document.createTextNode((parsed.sfxIds.length ? " · SFX " + parsed.sfxIds.join(", ") : " · no SFX IDs") + " · ." + parsed.format + " → ." + target));
    info.append(name, meta);
    if (parsed.description) {
      const description = document.createElement("p");
      description.className = "result-description";
      description.textContent = parsed.description;
      info.append(description);
    }
    const link = document.createElement("a");
    link.className = "download-button";
    link.href = translationUrl;
    link.download = outputFilename(parsed, target);
    link.textContent = "Download ." + target;
    row.append(info, link);
    translateResult.replaceChildren(row);
  } catch (error) {
    showError(translateResult, error);
  } finally {
    translateResult.removeAttribute("aria-busy");
  }
}

function showError(container, error) {
  const message = document.createElement("div");
  message.className = "error-message";
  message.textContent = error instanceof Error ? error.message : "The level could not be processed.";
  container.replaceChildren(message);
}

function clickDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadAs(level, format) {
  const blob = await convertLevel(level, format);
  clickDownload(blob, outputFilename(level, format));
}

async function addLibraryFiles(files) {
  libraryStatus.textContent = "Reading " + files.length + (files.length === 1 ? " level…" : " levels…");
  const results = await Promise.all(files.map(async file => {
    try { return { level: await parseLevelFile(file), filename: file.name }; }
    catch (error) { return { error: file.name + ": " + (error instanceof Error ? error.message : "could not be read") }; }
  }));
  const successes = results.filter(result => result.level);
  library.push(...successes);
  renderLibrary();
  const errors = results.filter(result => result.error).map(result => result.error);
  libraryStatus.textContent = successes.length + " added" + (errors.length ? " · " + errors.join(" · ") : "");
}

function renderLibrary() {
  libraryList.replaceChildren();
  if (!library.length) {
    const empty = document.createElement("div");
    empty.className = "empty-library";
    empty.textContent = "Your uploaded levels will appear here.";
    libraryList.append(empty);
    return;
  }
  for (const item of library) {
    const card = document.createElement("article");
    card.className = "level-card";
    const head = document.createElement("div");
    head.className = "level-card-head";
    const title = document.createElement("div");
    title.className = "level-card-title";
    title.textContent = item.level.name;
    const format = document.createElement("span");
    format.className = "level-card-format font-gold";
    format.textContent = "." + item.level.format.toUpperCase();
    head.append(title, format);
    card.append(head);
    const description = document.createElement("p");
    description.className = "level-description";
    description.append(document.createTextNode((item.level.description || "No description in this file.") + " · Song ID "));
    const songId = document.createElement("span");
    songId.className = "font-gold";
    songId.textContent = String(item.level.songId ?? "unavailable");
    description.append(songId, document.createTextNode(item.level.sfxIds.length ? " · SFX " + item.level.sfxIds.join(", ") : ""));
    card.append(description);
    const buttons = document.createElement("div");
    buttons.className = "level-downloads";
    for (const target of ["gmd", "gdlvl"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "download-button";
      button.textContent = "Download ." + target;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await downloadAs(item.level, target); }
        catch (error) { libraryStatus.textContent = error instanceof Error ? error.message : "Could not create download."; }
        finally { button.disabled = false; }
      });
      buttons.append(button);
    }
    card.append(buttons);
    libraryList.append(card);
  }
}

function aiSchema() {
  const placement = ids => ({
    type: "object",
    properties: {
      id: { type: "integer", enum: ids },
      x: { type: "number" },
      y: { type: "number" },
      rotation: { type: "number" },
      scale: { type: "number" }
    },
    required: ["id", "x", "y", "rotation", "scale"],
    additionalProperties: false
  });
  const gameplayIds = [1, 2, 3, 8, 13, 35, 36, 39, 41, 67, 200, 745, 1329];
  const decorationIds = [48, 49, 50, 51, 52, 53, 54, 60, 85, 86, 87, 97, 106, 107, 110, 113, 114, 115, 129, 130, 131, 132, 133, 134, 136, 137, 138, 139, 148, 149, 150, 157, 158, 159, 1734, 1735, 1736, 1743, 180, 181, 182, 190, 3810, 3811, 3812];
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      palette: { type: "array", items: { type: "string" } },
      gameplay: { type: "array", items: placement(gameplayIds) },
      decorations: { type: "array", items: placement(decorationIds) }
    },
    required: ["name", "description", "palette", "gameplay", "decorations"],
    additionalProperties: false
  };
}

serverSearch.addEventListener("submit", async event => {
  event.preventDefault();
  const query = serverQuery.value.trim();
  const server = serverUrl.value.trim();
  if (!query) return;
  serverSearchButton.disabled = true;
  serverStatus.textContent = "Searching the GD server…";
  serverResults.replaceChildren();
  try {
    const params = new URLSearchParams({ q: query });
    if (server) params.set("server", server);
    const response = await fetch("/api/gd/search?" + params);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The GD server search failed.");
    renderServerResults(result.results || [], server);
    serverStatus.textContent = result.results?.length ? result.results.length + " levels found." : "No matching levels found.";
  } catch (error) {
    serverStatus.textContent = error instanceof Error ? error.message : "Could not reach the GD server.";
  } finally {
    serverSearchButton.disabled = false;
  }
});

function renderServerResults(levels, server) {
  serverResults.replaceChildren();
  for (const level of levels) {
    const card = document.createElement("article");
    card.className = "level-card";
    const head = document.createElement("div");
    head.className = "level-card-head";
    const title = document.createElement("div");
    title.className = "level-card-title";
    title.textContent = level.name || "Untitled level";
    const author = document.createElement("span");
    author.className = "level-card-format";
    if (level.author) {
      const username = document.createElement("span");
      username.className = "font-gold";
      username.textContent = level.author;
      author.append(document.createTextNode("by "), username, document.createTextNode(" · "));
    }
    const levelId = document.createElement("span");
    levelId.className = "font-gold";
    levelId.textContent = String(level.id);
    author.append(document.createTextNode("ID "), levelId);
    head.append(title, author);
    card.append(head);
    const description = document.createElement("p");
    description.className = "level-description";
    description.textContent = level.description || "No description.";
    card.append(description);
    const song = document.createElement("p");
    song.className = "level-description";
    song.append(document.createTextNode("Song ID "));
    const songId = document.createElement("span");
    songId.className = "font-gold";
    songId.textContent = String(level.songId ?? "unavailable");
    song.append(songId);
    card.append(song);
    const buttons = document.createElement("div");
    buttons.className = "level-downloads";
    for (const format of ["gmd", "gdlvl"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "download-button";
      button.textContent = "Download ." + format;
      button.addEventListener("click", () => downloadServerLevel(level, format, button, server));
      buttons.append(button);
    }
    card.append(buttons);
    serverResults.append(card);
  }
}

async function downloadServerLevel(level, format, button, baseUrl) {
  button.disabled = true;
  serverStatus.textContent = "Fetching level data…";
  try {
    const cacheKey = (baseUrl || "official") + ":" + level.id;
    let parsed = serverLevelCache.get(cacheKey);
    if (!parsed) {
      const params = new URLSearchParams({ id: String(level.id) });
      if (baseUrl) params.set("server", baseUrl);
      const response = await fetch("/api/gd/level?" + params);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The level could not be downloaded from GD.");
      const downloadedId = String(result.level.id || "");
      if (!downloadedId || downloadedId !== String(level.id)) {
        throw new Error("The server returned level ID " + (downloadedId || "unknown") + " instead of " + level.id + ".");
      }
      if (level.songId != null && result.level.songId != null && Number(level.songId) !== Number(result.level.songId)) {
        throw new Error("The server listed song ID " + level.songId + " but returned song ID " + result.level.songId + ". Download stopped to avoid a mismatched song.");
      }
      parsed = await createGdServerLevel({
        ...result.level,
        id: downloadedId,
        author: level.author || result.level.author,
        officialSongId: level.officialSongId ?? result.level.officialSongId,
        customSongId: level.customSongId ?? result.level.customSongId
      });
      serverLevelCache.set(cacheKey, parsed);
    }
    const blob = await convertLevel(parsed, format);
    clickDownload(blob, outputFilename(parsed, format));
    serverStatus.textContent = "Downloaded " + parsed.name + ".";
  } catch (error) {
    serverStatus.textContent = error instanceof Error ? error.message : "Could not create the level file.";
  } finally {
    button.disabled = false;
  }
}

generateForm.addEventListener("submit", async event => {
  event.preventDefault();
  const idea = document.querySelector("#ai-prompt").value.trim();
  const profile = document.querySelector('input[name="ai-profile"]:checked')?.value || "builder";
  if (!idea) return;
  if (!window.websim?.chat?.completions?.create) {
    generateStatus.textContent = "AI generation is unavailable right now.";
    return;
  }
  generatedResult.hidden = true;
  generateButton.disabled = true;
  generateStatus.textContent = "Designing your level…";
  try {
    const completion = await window.websim.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "Create a Geometry Dash level in the style of the supplied How2 example: compact, crisp construction on a 30-unit grid; bright orange/cyan/white accents; grouped block runs, carefully spaced spikes, a few orb and portal beats, and small clusters of recognizable decoration. Do not make a bare obstacle line. Return 75–105 gameplay objects plus 30–55 decorations in three coherent sections across x=255–3900. Keep gameplay near y=15–255, with plausible landings and short breathers. Gameplay IDs: 1,2,3 for blocks, 8 and 39 for spikes, 35/36 for pad/orb, 13/745 for mode portals, 41/67/200/1329 for other known elements. Decorations must use only the dedicated art IDs allowed by the schema: clouds/balls, gears/chains, brick/art pieces, plus How2's ornament IDs 1734,1735,1736,1743,3810,3811,3812. Place decorations as small repeated motifs around the route, not as solid block substitutes. Pick a cohesive 3-color palette and give a short descriptive name and description. Return name, description, palette [primary, secondary, detail] as hex strings, gameplay [{id,x,y,rotation,scale}], and decorations [{id,x,y,rotation,scale}]. Use 30-unit x spacing and 15-degree rotations; keep scale from 0.5 to 2.0. No IDs outside the schema.\n\nGeneration profile: " + (aiProfileFocus[profile] || aiProfileFocus.builder) + ""
        },
        { role: "user", content: idea }
      ],
      schema: aiSchema()
    });
    const generated = JSON.parse(completion.content);
    generatedLevel = await createGeneratedLevel(generated);
    renderGeneratedLevel(generatedLevel);
    generateStatus.textContent = "Created " + generatedLevel.gameplayCount.toLocaleString() + " gameplay objects and " + generatedLevel.decorationCount.toLocaleString() + " decorations.";
  } catch (error) {
    generateStatus.textContent = error instanceof Error ? error.message : "The level could not be generated. Try again.";
  } finally {
    generateButton.disabled = false;
  }
});

function renderGeneratedLevel(level) {
  generatedResult.replaceChildren();
  const title = document.createElement("h3");
  title.className = "font-gold";
  title.textContent = level.name;
  const description = document.createElement("p");
  description.className = "generated-meta";
  description.textContent = level.description || "AI-generated Geometry Dash level.";
  const meta = document.createElement("p");
  meta.className = "generated-meta";
  meta.textContent = level.gameplayCount.toLocaleString() + " gameplay objects · " + level.decorationCount.toLocaleString() + " decorations";
  const buttons = document.createElement("div");
  buttons.className = "generated-downloads";
  for (const format of ["gmd", "gdlvl"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "download-button";
    button.textContent = "Download ." + format;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await downloadAs(level, format); }
      catch (error) { generateStatus.textContent = error instanceof Error ? error.message : "Could not create download."; }
      finally { button.disabled = false; }
    });
    buttons.append(button);
  }
  generatedResult.append(title, description, meta, buttons);
  generatedResult.hidden = false;
}

const creditsDialog = document.querySelector("#credits-dialog");
document.querySelector("#open-credits").addEventListener("click", () => creditsDialog.showModal());
document.querySelector("#close-credits").addEventListener("click", () => creditsDialog.close());
creditsDialog.addEventListener("click", event => {
  if (event.target === creditsDialog) creditsDialog.close();
});

async function loadCreatorCredit() {
  if (typeof window.websim?.getCreator !== "function") return;
  try {
    const creator = await window.websim.getCreator();
    if (!creator?.username) return;
    const link = document.createElement("a");
    link.className = "creator-credit-link";
    link.href = "https://websim.com/@" + encodeURIComponent(creator.username);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const avatar = document.createElement("img");
    avatar.src = "https://images.websim.com/avatar/" + encodeURIComponent(creator.username);
    avatar.alt = "";
    const username = document.createElement("span");
    username.textContent = "@" + creator.username;
    link.append(avatar, username);
    document.querySelector("#creator-credit").replaceChildren(link);
  } catch {
    // Keep the generic creator credit when project metadata is unavailable.
  }
}

void loadCreatorCredit();
renderLibrary();
