import { appendFile, mkdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";

import type { GenerationPlane } from "./catalog/types";
import type { GenerationStatus } from "./platform";

/** One row per submit and per final status. Rows go to the central sheet
    (LOG_WEBHOOK_URL + LOG_WEBHOOK_TOKEN) and, when
    USAGE_LOG_DIR is set, to a local CSV as well. The platform returns no
    price, so cost is an estimate from observed rates; the console's billing
    page stays the authority. Only the key's public id is written. */
const FILE = "generations.csv";
const HEADER = [
  "zeit",
  "rechner",
  "ereignis",
  "request_id",
  "key_id",
  "modell",
  "dauer_s",
  "aufloesung",
  "audio",
  "inputs",
  "kosten_geschaetzt_usd",
  "prompt",
];

/** USD per output second, measured on real runs. Missing means unknown. */
const USD_PER_SECOND: Record<string, Record<string, number>> = {
  "seedance-2.5": { "480p": 2.16 / 15 },
};

type Field = string | number;
type Submitted = { model: string; seconds: number | null; resolution: string };
const submitted = new Map<string, Submitted>();
const logged = new Set<string>();

const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);

export async function logSubmit(requestId: string, apiKey: string, plane: GenerationPlane) {
  const seconds = typeof plane.settings.duration === "number" ? plane.settings.duration : null;
  const resolution = typeof plane.settings.resolution === "string" ? plane.settings.resolution : "";
  submitted.set(requestId, { model: plane.model, seconds, resolution });
  const inputs = Object.values(plane.media).reduce((sum, items) => sum + (items?.length ?? 0), 0);
  await write([
    "submitted",
    requestId,
    keyId(apiKey),
    plane.model,
    seconds ?? "",
    resolution,
    plane.settings.generateAudio === true ? "ja" : "nein",
    inputs,
    "",
    plane.prompt.text.replace(/\s+/g, " ").slice(0, 300),
  ]);
}

export function logIfFinal(requestId: string, apiKey: string, status: GenerationStatus) {
  if (!TERMINAL.has(status.status) || logged.has(requestId)) return;
  logged.add(requestId);
  const run = submitted.get(requestId);
  submitted.delete(requestId);
  const cost = status.status === "completed" && run ? estimate(run) : null;
  void write([
    status.status,
    requestId,
    keyId(apiKey),
    run?.model ?? "",
    run?.seconds ?? "",
    run?.resolution ?? "",
    "",
    "",
    cost === null ? (status.status === "completed" ? "unbekannt" : 0) : Math.round(cost * 100) / 100,
    "",
  ]);
}

function estimate(run: Submitted): number | null {
  const rate = USD_PER_SECOND[run.model]?.[run.resolution];
  return rate !== undefined && run.seconds !== null ? rate * run.seconds : null;
}

async function write(fields: Field[]) {
  const row = [localTime(new Date()), hostname(), ...fields];
  await Promise.all([sendToSheet(row), appendToCsv(row)]);
}

async function sendToSheet(row: Field[]) {
  const url = process.env.LOG_WEBHOOK_URL?.trim();
  const token = process.env.LOG_WEBHOOK_TOKEN?.trim();
  if (!url || !token) return;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, header: HEADER, row }),
    });
    const answer = (await response.text()).trim();
    if (!response.ok || answer !== "ok") console.warn("[usage-log] sheet refused", response.status, answer.slice(0, 200));
  } catch (caught) {
    console.warn("[usage-log] sheet unreachable", caught);
  }
}

async function appendToCsv(row: Field[]) {
  const dir = process.env.USAGE_LOG_DIR?.trim();
  if (!dir) return;
  try {
    await mkdir(dir, { recursive: true });
    const path = join(dir, FILE);
    const fresh = !(await exists(path));
    const line = row.map(csv).join(";");
    await appendFile(path, `${fresh ? `﻿${HEADER.join(";")}\n` : ""}${line}\n`);
  } catch (caught) {
    console.warn("[usage-log] could not write", caught);
  }
}

function localTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function keyId(apiKey: string): string {
  return apiKey.slice(0, apiKey.indexOf(":"));
}

/** Semicolons, decimal commas and a BOM so Excel and Numbers open it in German
    locale as-is. */
function csv(value: Field): string {
  const text = typeof value === "number" ? String(value).replace(".", ",") : value;
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
