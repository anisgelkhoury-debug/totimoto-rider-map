/**
 * Build a Firebase Storage path ref from a download URL or raw object path.
 */
export function storagePathFromUrlOrPath(urlOrPath: string): string {
  if (!urlOrPath.startsWith("http")) {
    return urlOrPath
  }
  const parsed = new URL(urlOrPath)
  const match = parsed.pathname.match(/\/o\/(.+)$/)
  if (!match) {
    throw new Error("Invalid Firebase Storage download URL")
  }
  return decodeURIComponent(match[1])
}
