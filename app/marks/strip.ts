import { scan } from "./scan.ts";

/** Remove every recognized rivet tag. Host characters are unchanged. */
export function strip(body: string): string {
  let out = "";
  for (const tok of scan(body)) {
    if (tok.kind === "text") {
      out += tok.value;
    }
  }
  return out;
}
