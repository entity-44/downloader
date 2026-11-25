/**
 * Removes whitespace that JavaScript doesn't need, without touching strings,
 * regular expressions or template literals. Used to keep the bookmark under
 * iPhone's bookmark length limit. Our generated code has no comments.
 */
export function compactJs(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  let inRegex = false;
  let inClass = false;
  let lastSig = ""; // last non-space character emitted outside strings/regex
  const isId = (ch: string) => /[A-Za-z0-9_$\u0080-￿]/.test(ch);
  const regexCanStart = () => lastSig === "" || "(,=:[!&|?{};+".includes(lastSig) || /(?:^|[^\w$])(?:return|typeof)$/.test(out);
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === quote) {
        quote = null;
        lastSig = c;
      }
      i++;
      continue;
    }
    if (inRegex) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        inRegex = false;
        lastSig = c;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && regexCanStart()) {
      inRegex = true;
      inClass = false;
      out += c;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n") {
      let j = i;
      while (src[j] === " " || src[j] === "\t" || src[j] === "\n") j++;
      const prev = out[out.length - 1] ?? "";
      const next = src[j] ?? "";
      // Keep one space only where removing it would join tokens.
      if ((isId(prev) && isId(next)) || (prev === "+" && next === "+") || (prev === "-" && next === "-")) out += " ";
      i = j;
      continue;
    }
    out += c;
    lastSig = c;
    i++;
  }
  return out;
}
