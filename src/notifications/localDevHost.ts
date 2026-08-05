/** Hostnames allowed for local-only developer tools (mock SW notifications, etc.). */
export function isLocalDevHostname(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]"
}
