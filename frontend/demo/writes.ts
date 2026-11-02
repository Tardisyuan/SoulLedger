/** What the demo does with POST / PATCH / PUT / DELETE. Mainline behaviour is in `flows.ts`; this is the generic rule. */
import { flow } from "./flows";
import { type Answer, type Recording, addRow, deleteRow, emptyLike, getOverlay, newId, patchRow, read, rowsNow, saveOverlay } from "./store";

type Row = Record<string, unknown>;

/** A new row looks like its neighbours, so a screen that reads `row.soul.name` still finds one. */
export function fromTemplate(rec: Recording, collection: string, body: Row): Row {
  const template = rowsNow(rec, collection)[0] ?? {};
  const now = new Date().toISOString();
  const stamps = Object.fromEntries(Object.keys(template).filter((k) => /(_at|_time)$/.test(k)).map((k) => [k, /^(created|updated|update|create)/.test(k) ? now : null]));
  return { ...template, ...stamps, created_at: now, ...body, id: typeof template.id === "number" ? 100000 + getOverlay().seq++ : newId() };
}

const ID_SEGMENT = /^(?:[0-9a-f-]{36}|\d+)$/i;

function collectionPath(rec: Recording, path: string): boolean {
  return Object.keys(rec.lists).some((k) => k.split("?")[0] === path) || Array.isArray(rec.docs[path]?.b);
}

function generic(rec: Recording, method: string, path: string, query: URLSearchParams, body: Row): Answer {
  const parts = path.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const lastIsId = ID_SEGMENT.test(last);
  const collection = lastIsId ? `/${parts.slice(0, -1).join("/")}/` : path;

  if (lastIsId && method === "DELETE") {
    deleteRow(collection, last);
    return { status: 204, data: null };
  }
  if (lastIsId && (method === "PATCH" || method === "PUT")) {
    patchRow(collection, last, body);
    return read(rec, path, query);
  }
  if (method === "POST" && !lastIsId && collectionPath(rec, path)) {
    const row = fromTemplate(rec, collection, body);
    addRow(collection, row);
    return { status: 201, data: row };
  }
  // `/things/<id>/some-action/`: nothing changes, and the caller gets the thing back.
  if (method === "POST" && parts.length >= 2 && ID_SEGMENT.test(parts[parts.length - 2])) {
    const owner = read(rec, `/${parts.slice(0, -1).join("/")}/`, new URLSearchParams());
    console.info("[demo] accepted without effect:", method, path);
    return { status: 200, data: owner.data };
  }
  console.info("[demo] accepted without effect:", method, path);
  return { status: 200, data: emptyLike() };
}

export function write(rec: Recording, method: string, path: string, query: URLSearchParams, body: Row): Answer {
  const answer = flow(rec, method, path, query, body) ?? generic(rec, method, path, query, body);
  saveOverlay();
  return answer;
}
