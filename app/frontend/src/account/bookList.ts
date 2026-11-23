// Account redesign (23-11-26): the books the Account page offers, and how a library entry maps to the module id
// the database is keyed by.
//
// ⛔ The key is moduleIdFor({ moduleId }, file) — the book's OWN id when it has a valid one (that includes the
//    "t-clf-c02-…" id of the AWS Cloud Practitioner book), else "f-<file stem>". The library cards use a
//    different rule for "t-" ids (state/LibraryProvider.tsx), which is why this page used to show the raw id
//    "t-clf-c02-cloud-practitioner" and no lesson total for that book.
import { moduleIdFor } from '../data/bookPaths';
import type { ModulePayload } from '../data/types';

export interface LibraryBookLite {
  file: string;
  moduleId?: string;
  title: string;
  lessons?: number;
  lastReadAt?: number;
}

export interface AccountBook {
  file: string;
  module: string;
  title: string;
  lessons: number | undefined;
}

export function moduleKeyOf(book: { file: string; moduleId?: string }): string {
  return moduleIdFor({ moduleId: book.moduleId } as unknown as ModulePayload, book.file);
}

/** One entry per module id (the same book listed from two files shows once — the most recently read file wins). */
export function accountBooks(raw: unknown): AccountBook[] {
  const books = (Array.isArray(raw) ? raw : []).filter((b): b is LibraryBookLite => Boolean(b) && typeof (b as LibraryBookLite).file === 'string');
  const best = new Map<string, LibraryBookLite>();
  for (const book of books) {
    const key = moduleKeyOf(book);
    const seen = best.get(key);
    if (!seen || (Number(book.lastReadAt) || 0) > (Number(seen.lastReadAt) || 0)) best.set(key, book);
  }
  return [...best.entries()].map(([module, b]) => ({ file: b.file, module, title: b.title || module, lessons: b.lessons }));
}
