import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortHash(hash: string, size = 8) {
  return hash.length > size * 2 ? `${hash.slice(0, size)}…${hash.slice(-size)}` : hash;
}
