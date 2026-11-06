"use client";

/**
 * Names of the forms this device saved ("Sunrise Community Library Membership Form"), kept only on
 * the phone. The server stores a coarse category, never the title, so "My forms" can show a real name
 * without it leaving the device. Missing titles (another browser, cleared storage) fall back to the
 * category ("Bank form").
 */
const KEY = "saathi.formTitles";

export function formTitles(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function write(titles: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(titles));
  } catch {
    // storage unavailable: My forms falls back to category names
  }
}

export function rememberFormTitle(documentId: string, title: string) {
  if (!title.trim()) return;
  write({ ...formTitles(), [documentId]: title.trim().slice(0, 120) });
}

export function forgetFormTitle(documentId: string) {
  const { [documentId]: _gone, ...rest } = formTitles();
  write(rest);
}
