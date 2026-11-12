/**
 * Shared path utilities supporting both Windows (`\`) and POSIX (`/`) paths.
 */

export function cleanPath(value: string): string {
  return value.trim().replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
}

function stripTrailingSeparators(value: string): string {
  if (value === "/") return "/";
  if (/^[a-zA-Z]:[\\/]?$/.test(value)) {
    return `${value.slice(0, 2)}\\`;
  }
  return value.replace(/[\\/]+$/, "");
}

export function pathKey(value: string): string {
  const cleaned = cleanPath(value).replace(/\//g, "\\");
  return stripTrailingSeparators(cleaned).toLowerCase();
}

export function isAbsolutePath(value: string): boolean {
  const cleaned = cleanPath(value);
  return /^[a-zA-Z]:[\\/]/.test(cleaned) || cleaned.startsWith("/") || cleaned.startsWith("\\\\");
}

export function isInside(root: string, candidate: string): boolean {
  const rootKey = pathKey(root);
  const candidateKey = pathKey(candidate);
  const prefix = rootKey.endsWith("\\") ? rootKey : `${rootKey}\\`;
  return candidateKey === rootKey || candidateKey.startsWith(prefix);
}

export function parentPath(value: string): string {
  const cleaned = stripTrailingSeparators(cleanPath(value));
  const index = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  if (index < 0) return cleaned;
  if (index === 0) return "/";
  if (index === 2 && /^[a-zA-Z]:/.test(cleaned)) {
    return `${cleaned.slice(0, 2)}${cleaned[2]}`;
  }
  return cleaned.slice(0, index);
}

export function baseName(value: string): string {
  const trimmed = cleanPath(value).replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

export function joinPath(parent: string, name: string): string {
  const cleanedParent = cleanPath(parent);
  const sep = cleanedParent.includes("/") && !cleanedParent.includes("\\") ? "/" : "\\";
  return cleanedParent.replace(/[\\/]+$/, "") + sep + name;
}
