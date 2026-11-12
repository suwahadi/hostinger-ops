export class SafeHtml {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

// Every interpolated value is escaped unless it is itself the output of html``; Hostinger data never reaches the page raw.
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0]!;
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1]!;
  });
  return new SafeHtml(out);
}
