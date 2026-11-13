const HOSTNAME_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

export function isPlainHostname(domain: string): boolean {
  const labels = domain.split(".");
  if (domain.length > 253 || labels.length < 2 || !labels.every((label) => HOSTNAME_LABEL.test(label))) return false;
  // Belt and braces: the URL parser must read the same host back, with nothing after it.
  const url = new URL(`https://${domain}`);
  return url.hostname === domain.toLowerCase() && url.pathname === "/" && !url.username && !url.password;
}
