import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import type { GenerationStatus } from "./platform";

/** Finished runs are copied into ARCHIVE_DIR — on a Google Drive for Desktop
    folder, Drive uploads them on its own. Unset, archiving is off. The prompt
    is only known at submit, so a small note is left in `.pending/` then and
    read back when the run completes. */
const PENDING = ".pending";

type PendingNote = { model: string; prompt: string; submittedAt: string };

const saving = new Set<string>();

function archiveDir(): string | null {
  const dir = process.env.ARCHIVE_DIR?.trim();
  return dir ? dir : null;
}

export async function rememberSubmit(requestId: string, model: string, prompt: string) {
  const dir = archiveDir();
  if (!dir || !requestId) return;
  try {
    await mkdir(join(dir, PENDING), { recursive: true });
    const note: PendingNote = { model, prompt, submittedAt: new Date().toISOString() };
    await writeFile(join(dir, PENDING, `${safeId(requestId)}.json`), JSON.stringify(note, null, 2));
  } catch (caught) {
    console.warn("[archive] could not note submit", requestId, caught);
  }
}

/** Fire and forget: the status poll must never wait on a download. */
export function archiveIfDone(requestId: string, status: GenerationStatus) {
  const dir = archiveDir();
  if (!dir || status.status !== "completed" || saving.has(requestId)) return;
  saving.add(requestId);
  void save(dir, requestId, status)
    .catch((caught) => console.warn("[archive] failed", requestId, caught))
    .finally(() => saving.delete(requestId));
}

async function save(dir: string, requestId: string, status: GenerationStatus) {
  const urls = status.video ? [status.video.url] : (status.images ?? []).map((image) => image.url);
  if (urls.length === 0) return;

  const notePath = join(dir, PENDING, `${safeId(requestId)}.json`);
  // Survives server reloads, unlike `saving`: a run already archived is never
  // saved again under a second name.
  const donePath = join(dir, PENDING, `${safeId(requestId)}.done`);
  if (await exists(donePath)) return;
  const note = await readNote(notePath);
  const base = baseName(requestId, note);
  const folder = join(dir, ...dayFolders(note ? new Date(note.submittedAt) : new Date()));
  await mkdir(folder, { recursive: true });

  for (const [index, url] of urls.entries()) {
    const suffix = urls.length > 1 ? `_${index + 1}` : "";
    const target = join(folder, `${base}${suffix}${extensionOf(url)}`);
    if (await exists(target)) continue;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status}) ${url}`);
    // Written under a temp name first so Drive never syncs a half-written file.
    const partial = `${target}.part`;
    await writeFile(partial, Buffer.from(await response.arrayBuffer()));
    await rename(partial, target);
    console.info("[archive] saved", target);
  }

  if (note) {
    await writeFile(join(folder, `${base}.txt`),`${note.model}\n${note.submittedAt}\n\n${note.prompt}\n`);
  }
  await mkdir(join(dir, PENDING), { recursive: true });
  await writeFile(donePath, base);
  await rm(notePath, { force: true });
}

async function readNote(path: string): Promise<PendingNote | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PendingNote;
  } catch {
    return null;
  }
}

function baseName(requestId: string, note: PendingNote | null): string {
  const when = localStamp(note ? new Date(note.submittedAt) : new Date());
  const id = safeId(requestId).slice(0, 8);
  if (!note) return `${when}_${id}`;
  const model = slug(note.model.split("/").slice(-3).join("-"), 40);
  const prompt = slug(note.prompt, 40);
  return [when, model, prompt, id].filter(Boolean).join("_");
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Local wall-clock time, so filenames sort and read as the user saw them. */
function localStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

/** `2026-10/2026-10-27`: one folder per month, one per day inside it. */
function dayFolders(date: Date): [string, string] {
  const month = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  return [month, `${month}-${pad(date.getDate())}`];
}

function extensionOf(url: string): string {
  try {
    const ext = extname(new URL(url).pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {}
  return ".mp4";
}

function slug(text: string, max: number): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "")
    .toLowerCase();
}

function safeId(requestId: string): string {
  return requestId.replace(/[^a-zA-Z0-9-]/g, "");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
