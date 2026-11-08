const GD_API = "https://www.boomlings.com/database/";
const GD_SECRET = "Wmfd2893gb7";

function parseFields(record) {
  const values = String(record || "").split(":");
  const fields = new Map();
  for (let i = 0; i + 1 < values.length; i += 2) fields.set(values[i], values[i + 1]);
  return fields;
}

function decodeDescription(value) {
  if (!value) return "";
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
  } catch {
    return value;
  }
}

function parseCreators(section) {
  const creators = new Map();
  for (const entry of String(section || "").split("|")) {
    const parts = entry.split(":");
    if (parts.length >= 2) creators.set(parts[0], parts[1]);
  }
  return creators;
}

function fromRecord(record, creators = new Map()) {
  const fields = parseFields(record);
  const creatorId = fields.get("6") || "";
  const officialSongText = fields.get("12") || "";
  const customSongText = fields.get("35") || "";
  const officialSongValue = /^\d+$/.test(officialSongText) ? Number(officialSongText) : null;
  const customSongValue = /^\d+$/.test(customSongText) ? Number(customSongText) : null;
  const officialSongId = Number.isSafeInteger(officialSongValue) ? officialSongValue : null;
  const customSongId = Number.isSafeInteger(customSongValue) ? customSongValue : null;
  const songId = customSongId > 0 ? customSongId : officialSongId;
  return {
    id: fields.get("1") || "",
    name: fields.get("2") || "Untitled level",
    description: decodeDescription(fields.get("3") || ""),
    author: creators.get(creatorId) || fields.get("username") || (creatorId ? "Creator " + creatorId : "Unknown creator"),
    downloads: Number(fields.get("10") || 0),
    likes: Number(fields.get("14") || 0),
    difficulty: fields.get("9") || "",
    levelData: fields.get("4") || fields.get("k4") || "",
    songId,
    officialSongId,
    customSongId
  };
}

function getServerApiBases(value) {
  if (!value) return [GD_API];
  let url;
  try { url = new URL(value); }
  catch { throw new Error("Enter a valid custom server URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) server URL without credentials, query, or fragment.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("That custom server host is not allowed.");
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    const octets = hostname.split(".").map(Number);
    const [a, b, c] = octets;
    if (octets.some(part => part > 255) || a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
        (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
        (a === 203 && b === 0 && c === 113)) {
      throw new Error("That custom server host is not publicly routable.");
    }
  } else if (hostname.includes(":")) {
    if (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || /^fe[89ab]/.test(hostname) || hostname.startsWith("::ffff:")) {
      throw new Error("That custom server host is not publicly routable.");
    }
  }
  const path = url.pathname.replace(/\/+$/, "");
  const bases = [];
  const addBase = pathname => {
    url.pathname = pathname || "/";
    const base = url.toString().replace(/\/+$/, "") + "/";
    if (!bases.includes(base)) bases.push(base);
  };
  if (/\.php$/i.test(path)) {
    addBase(path.slice(0, path.lastIndexOf("/") + 1));
    if (/\/database$/i.test(path)) addBase(path.slice(0, path.toLowerCase().lastIndexOf("/database")) + "/");
  } else {
    const prefix = /\/database$/i.test(path) ? path.slice(0, path.toLowerCase().lastIndexOf("/database")) : path;
    addBase(prefix + "/database/");
    addBase(prefix + "/");
    addBase("/database/");
    addBase("/");
  }
  return bases;
}

async function postGD(endpoint, fields, apiBases = [GD_API]) {
  let lastResponse;
  for (const apiBase of apiBases) {
    const response = await fetch(apiBase + endpoint, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString()
    });
    if (response.status === 404) {
      lastResponse = response;
      continue;
    }
    if (!response.ok) throw new Error("Geometry Dash server returned HTTP " + response.status + ".");
    return response.text();
  }
  if (lastResponse) throw new Error("No GD API endpoint was found at the custom server URL (HTTP 404). Try the server domain or its /database URL.");
  throw new Error("Could not reach the Geometry Dash server.");
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET") return Response.json({ error: "Use GET for GD server requests." }, { status: 405 });

    if (url.pathname === "/api/gd/search") {
      const query = (url.searchParams.get("q") || "").trim().slice(0, 80);
      if (!query) return Response.json({ error: "Enter a level name to search." }, { status: 400 });
      const page = Math.max(0, Math.min(99, Number.parseInt(url.searchParams.get("page") || "0", 10) || 0));
      let apiBases;
      try { apiBases = getServerApiBases((url.searchParams.get("server") || "").trim()); }
      catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
      try {
        const text = await postGD("getGJLevels21.php", {
          gameVersion: "22",
          binaryVersion: "51",
          gdw: "0",
          type: "0",
          str: query,
          page: String(page),
          total: "0",
          secret: GD_SECRET
        }, apiBases);
        if (text.trim() === "-1") return Response.json({ results: [], page });
        if (text.trim().startsWith("-")) return Response.json({ error: "The Geometry Dash server rejected this search." }, { status: 502 });
        const sections = text.split("#");
        const creators = parseCreators(sections[1]);
        const results = sections[0].split("|").filter(Boolean).map(record => fromRecord(record, creators)).filter(level => level.id);
        return Response.json({ results, page });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not reach the Geometry Dash server." }, { status: 502 });
      }
    }

    if (url.pathname === "/api/gd/level") {
      const id = (url.searchParams.get("id") || "").trim();
      if (!/^\d+$/.test(id) || Number(id) <= 0) return Response.json({ error: "Invalid level ID." }, { status: 400 });
      let apiBases;
      try { apiBases = getServerApiBases((url.searchParams.get("server") || "").trim()); }
      catch (error) { return Response.json({ error: error.message }, { status: 400 }); }
      try {
        const text = await postGD("downloadGJLevel22.php", {
          levelID: id,
          inc: "1",
          extras: "0",
          gameVersion: "22",
          binaryVersion: "51",
          gdw: "0",
          accountID: "0",
          gjp2: "",
          secret: GD_SECRET
        }, apiBases);
        if (text.trim() === "-1" || text.trim().startsWith("-")) return Response.json({ error: "That level could not be downloaded from the Geometry Dash server." }, { status: 404 });
        const record = fromRecord(text.split("#")[0]);
        if (!record.levelData) return Response.json({ error: "The Geometry Dash response did not contain level data." }, { status: 502 });
        return Response.json({ level: record });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Could not download level data from the Geometry Dash server." }, { status: 502 });
      }
    }

    return Response.json({ error: "Not found." }, { status: 404 });
  }
};
