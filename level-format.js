const XML_DECLARATION = '<?xml version="1.0"?>';

function base64UrlBytes(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

function isGzip(bytes) {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function decompress(bytes) {
  if (typeof DecompressionStream !== "function") throw new Error("This browser cannot unpack Geometry Dash level data.");
  const format = isGzip(bytes) ? "gzip" : "deflate";
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Response(stream).text();
}

async function decompressLevelString(value) {
  const source = String(value || "").trim();
  if (!source) throw new Error("The file has no level data.");
  if (source.startsWith("kS38") || (source.includes(";") && source.includes(","))) return source;
  return decompress(base64UrlBytes(source));
}

async function compressText(value) {
  if (typeof CompressionStream !== "function") throw new Error("This browser cannot compress level files.");
  const stream = new Blob([value]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseXml(source) {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("This is not a readable level plist.");
  const root = doc.documentElement;
  const dict = root.localName === "plist"
    ? Array.from(root.children).find(child => child.localName === "dict" || child.localName === "d")
    : root.localName === "dict" || root.localName === "d" ? root : null;
  if (!dict) throw new Error("The level file does not contain a recognized plist dictionary.");
  const fields = new Map();
  const children = Array.from(dict.children);
  for (let i = 0; i + 1 < children.length; i++) {
    if (children[i].localName === "k" || children[i].localName === "key") {
      fields.set(children[i].textContent.trim(), children[++i].textContent || "");
    }
  }
  return { doc, dict, fields };
}

function serializePlist(doc, dict) {
  const serializer = new XMLSerializer();
  const contents = Array.from(dict.children).map(child => serializer.serializeToString(child)).join("");
  return XML_DECLARATION + '<plist version="1.0" gjver="2.0"><dict>' + contents + "</dict></plist>";
}

function decodeDescription(value) {
  if (!value) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(base64UrlBytes(value));
  } catch {
    return value;
  }
}

function extractSfxIds(levelData) {
  const ids = new Set();
  for (const segment of levelData.split(";").slice(1)) {
    const values = segment.split(",");
    let objectId = "";
    let sfxId = "";
    for (let i = 0; i + 1 < values.length; i += 2) {
      if (values[i] === "1") objectId = values[i + 1];
      if (values[i] === "441") sfxId = values[i + 1];
    }
    if (objectId === "3600" && /^\d+$/.test(sfxId) && Number(sfxId) > 0) ids.add(Number(sfxId));
  }
  return Array.from(ids).sort((a, b) => a - b);
}

export async function parseLevelXml(source, format) {
  const parsed = parseXml(source);
  const levelData = parsed.fields.get("k4");
  if (!levelData) throw new Error("This file has no level data (k4 field).");
  const decodedLevel = await decompressLevelString(levelData);
  const objectCount = decodedLevel.split(";").slice(1).filter(segment => segment.trim()).length;
  const officialSongText = parsed.fields.get("k8")?.trim() || "";
  const customSongText = parsed.fields.get("k45")?.trim() || "";
  const officialSongValue = /^\d+$/.test(officialSongText) ? Number(officialSongText) : null;
  const customSongValue = /^\d+$/.test(customSongText) ? Number(customSongText) : null;
  const officialSongId = Number.isSafeInteger(officialSongValue) ? officialSongValue : null;
  const customSongId = Number.isSafeInteger(customSongValue) ? customSongValue : null;
  const songId = officialSongId ?? customSongId;
  return {
    format,
    xml: serializePlist(parsed.doc, parsed.dict),
    name: parsed.fields.get("k2") || "Untitled level",
    description: decodeDescription(parsed.fields.get("k3")),
    songId,
    officialSongId,
    customSongId,
    sfxIds: extractSfxIds(decodedLevel),
    objectCount
  };
}

export async function parseLevelFile(file) {
  const format = file.name.toLowerCase().endsWith(".gdlvl") ? "gdlvl" : file.name.toLowerCase().endsWith(".gmd") ? "gmd" : null;
  if (!format) throw new Error("Choose a .gmd or .gdlvl level file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let source;
  if (format === "gdlvl" && isGzip(bytes)) {
    source = await decompress(bytes);
  } else {
    source = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "").replace(/\0+$/, "").trim();
    if (format === "gdlvl" && !source.startsWith("<")) source = await decompress(base64UrlBytes(source));
  }
  return parseLevelXml(source, format);
}

function setField(doc, dict, fields, name, tag, text) {
  const children = Array.from(dict.children);
  for (let i = 0; i + 1 < children.length; i += 2) {
    if ((children[i].localName === "k" || children[i].localName === "key") && children[i].textContent.trim() === name) {
      const value = doc.createElement(tag);
      if (tag !== "t") value.textContent = text == null ? "" : String(text);
      children[i + 1].replaceWith(value);
      fields.set(name, tag === "t" ? "" : String(text == null ? "" : text));
      return;
    }
  }
  const key = doc.createElement("k");
  key.textContent = name;
  const value = doc.createElement(tag);
  if (tag !== "t") value.textContent = text == null ? "" : String(text);
  dict.append(key, value);
  fields.set(name, tag === "t" ? "" : String(text == null ? "" : text));
}

function removeField(dict, fields, name) {
  const children = Array.from(dict.children);
  for (let i = 0; i + 1 < children.length; i += 2) {
    if ((children[i].localName === "k" || children[i].localName === "key") && children[i].textContent.trim() === name) {
      children[i].remove();
      children[i + 1].remove();
      fields.delete(name);
      return;
    }
  }
}

function migrateToGdlvl(doc, dict, fields, objectCount) {
  const gameVersion = fields.get("k17");
  const editTime = fields.get("k80");
  if (gameVersion !== undefined) {
    setField(doc, dict, fields, "k80", "i", gameVersion);
    removeField(dict, fields, "k17");
  }
  if (editTime !== undefined) setField(doc, dict, fields, "k81", "i", editTime);
  setField(doc, dict, fields, "k13", "t", "");
  setField(doc, dict, fields, "k21", "i", "2");
  setField(doc, dict, fields, "k50", "i", "51");
  setField(doc, dict, fields, "k48", "i", objectCount);
}

function migrateToGmd(doc, dict, fields) {
  const gameVersion = fields.get("k80");
  const editTime = fields.get("k81");
  if (gameVersion !== undefined) setField(doc, dict, fields, "k17", "i", gameVersion);
  if (editTime !== undefined) setField(doc, dict, fields, "k80", "i", editTime);
  else if (gameVersion !== undefined) removeField(dict, fields, "k80");
  removeField(dict, fields, "k81");
  removeField(dict, fields, "k13");
  setField(doc, dict, fields, "k21", "i", "3");
  setField(doc, dict, fields, "k50", "i", "51");
}

export async function convertLevel(level, targetFormat) {
  const parsed = parseXml(level.xml);
  const xml = serializePlist(parsed.doc, parsed.dict);
  if (targetFormat === level.format) {
    if (targetFormat === "gmd") return new Blob([xml], { type: "application/octet-stream" });
    return new Blob([bytesToBase64Url(await compressText(xml))], { type: "application/octet-stream" });
  }
  const decoded = await decompressLevelString(parsed.fields.get("k4"));
  const count = decoded.split(";").slice(1).filter(segment => segment.trim()).length;
  if (targetFormat === "gdlvl") migrateToGdlvl(parsed.doc, parsed.dict, parsed.fields, count);
  else migrateToGmd(parsed.doc, parsed.dict, parsed.fields);
  const convertedXml = serializePlist(parsed.doc, parsed.dict);
  if (targetFormat === "gmd") return new Blob([convertedXml], { type: "application/octet-stream" });
  return new Blob([bytesToBase64Url(await compressText(convertedXml))], { type: "application/octet-stream" });
}

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function metadataPair(key, tag, value) {
  return "<k>" + key + "</k><" + tag + ">" + (tag === "t" ? "" : xmlEscape(value)) + "</" + tag + ">";
}

export async function createGeneratedLevel(data) {
  const gameplayIds = new Set([1, 2, 3, 8, 13, 35, 36, 39, 41, 67, 200, 745, 1329]);
  const decorationIds = new Set([48, 49, 50, 51, 52, 53, 54, 60, 85, 86, 87, 97, 106, 107, 110, 113, 114, 115, 129, 130, 131, 132, 133, 134, 136, 137, 138, 139, 148, 149, 150, 157, 158, 159, 1734, 1735, 1736, 1743, 180, 181, 182, 190, 3810, 3811, 3812]);
  const makePlacements = (items, allowed, decoration) => {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).map(object => ({
      id: Number(object.id),
      x: Math.round(Number(object.x) / 30) * 30,
      y: Math.round(Number(object.y) / 15) * 15,
      rotation: Math.round(Number(object.rotation || 0) / 15) * 15,
      scale: Math.max(0.5, Math.min(2, Math.round(Number(object.scale || 1) * 10) / 10))
    })).filter(object => allowed.has(object.id) && Number.isFinite(object.x) && Number.isFinite(object.y))
      .map(object => ({
        ...object,
        x: Math.max(0, Math.min(8000, object.x)),
        y: Math.max(15, Math.min(255, object.y)),
        rotation: Math.max(-180, Math.min(180, object.rotation)),
        decoration
      })).slice(0, decoration ? 100 : 160)
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .filter(object => {
        const key = object.id + ":" + object.x + ":" + object.y + ":" + object.rotation;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };
  const gameplay = makePlacements(data.gameplay, gameplayIds, false);
  const decorations = makePlacements(data.decorations, decorationIds, true);
  if (gameplay.length < 35 || decorations.length < 12) {
    throw new Error("The generator returned too little gameplay or decoration. Try generating again.");
  }

  const fallbackPalette = ["#d8f3ff", "#ffb8df", "#8aa6ff"];
  const palette = [0, 1, 2].map(index => {
    const hex = String(data.palette?.[index] || fallbackPalette[index]).replace(/^#/, "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return fallbackPalette[index].slice(1).match(/../g).map(part => parseInt(part, 16));
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  });
  const colorChannel = (color, id) => "1_" + color[0] + "_2_" + color[1] + "_3_" + color[2] + "_11_255_12_255_13_255_4_-1_6_" + id + "_7_1_15_0_18_0_8_1";
  const header = "kS38," + colorChannel(palette[0], 1000) + "|" + colorChannel(palette[1], 1001) + "|" + colorChannel(palette[2], 1004) + "|" + colorChannel(palette[1], 1010) + ",kA13,0,kA15,1,kA16,0,kA14,,kA6,1,kA7,0,kA17,0,kA18,0,kS39,0,kA2,0,kA3,0,kA8,0,kA4,0,kA9,0,kA10,0,kA11,0";
  const placements = gameplay.map((object, index) => ({ object, decoration: false, index }))
    .concat(decorations.map((object, index) => ({ object, decoration: true, index })))
    .sort((a, b) => a.object.x - b.object.x || Number(a.decoration) - Number(b.decoration) || a.object.y - b.object.y);
  const segments = placements.map(({ object, decoration, index }) => {
    const position = Math.round(object.x / 30) % 7;
    const color = position === 0 ? 1000 : position === 3 ? 1001 : 1004;
    let segment = "1," + object.id + ",2," + object.x + ",3," + object.y;
    if (decoration) {
      segment += ",21,1004,155,1";
      if (index % 2 === 0) segment += ",22,1010";
      if ([1734, 1735, 1736].includes(object.id)) segment += ",156,4";
    } else {
      segment += ",21," + color + ",155,1";
      if (object.id === 13 || object.id === 36 || object.id === 67 || object.id === 745) segment += ",36,1";
      if (object.id === 36 || object.id === 200) segment += ",11,1";
      if (object.id === 200) segment += ",13,1";
      if (object.id === 1329) segment += ",107,1,36,1";
    }
    if (object.rotation) segment += ",6," + object.rotation;
    if (object.scale !== 1) segment += ",128," + object.scale + ",129," + object.scale;
    return segment;
  });
  const objectCount = gameplay.length + decorations.length;
  const levelString = header + ";" + segments.join(";") + ";";
  const name = String(data.name || "AI Level").replace(/[\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 20) || "AI Level";
  const description = String(data.description || "AI-generated Geometry Dash level.").slice(0, 160);
  const encodedDescription = bytesToBase64Url(new TextEncoder().encode(description));
  const encodedLevel = bytesToBase64Url(await compressText(levelString));
  const xml = XML_DECLARATION + '<plist version="1.0" gjver="2.0"><dict>' +
    metadataPair("kCEK", "i", 4) + metadataPair("k2", "s", name) +
    metadataPair("k3", "s", encodedDescription) + metadataPair("k4", "s", encodedLevel) +
    metadataPair("k5", "s", "Level Shift AI") + metadataPair("k17", "i", 22) +
    metadataPair("k21", "i", 3) + metadataPair("k45", "i", 0) + metadataPair("k48", "i", objectCount) +
    metadataPair("k50", "i", 51) + metadataPair("k80", "i", 0) + "</dict></plist>";
  const level = await parseLevelXml(xml, "gmd");
  level.gameplayCount = gameplay.length;
  level.decorationCount = decorations.length;
  return level;
}

export async function createGdServerLevel(data) {
  if (!data || !data.levelData) throw new Error("The GD server response did not include level data.");
  const rawLevel = await decompressLevelString(data.levelData);
  const encodedLevel = bytesToBase64Url(await compressText(rawLevel));
  const description = String(data.description || "");
  const objectCount = rawLevel.split(";").slice(1).filter(segment => segment.trim()).length;
  const officialSongValue = data.officialSongId == null ? null : Number(data.officialSongId);
  const customSongValue = data.customSongId == null ? null : Number(data.customSongId);
  const officialSongId = Number.isSafeInteger(officialSongValue) && officialSongValue >= 0 ? officialSongValue : null;
  const customSongId = Number.isSafeInteger(customSongValue) && customSongValue >= 0 ? customSongValue : null;
  const songField = customSongId > 0
    ? metadataPair("k45", "i", customSongId)
    : officialSongId != null ? metadataPair("k8", "i", officialSongId) : "";
  const xml = XML_DECLARATION + '<plist version="1.0" gjver="2.0"><dict>' +
    metadataPair("kCEK", "i", 4) + metadataPair("k1", "i", data.id || 0) +
    metadataPair("k2", "s", data.name || "Untitled level") +
    metadataPair("k3", "s", bytesToBase64Url(new TextEncoder().encode(description))) +
    metadataPair("k4", "s", encodedLevel) + metadataPair("k5", "s", data.author || "") +
    metadataPair("k17", "i", 22) + metadataPair("k21", "i", 3) +
    metadataPair("k48", "i", objectCount) + metadataPair("k50", "i", 51) +
    songField + "</dict></plist>";
  const level = await parseLevelXml(xml, "gmd");
  level.serverId = data.id;
  return level;
}

export function outputFilename(level, format) {
  const safe = String(level.name || "level").replace(/[\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "level";
  return safe + "." + format;
}
