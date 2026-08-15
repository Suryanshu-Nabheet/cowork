export function toolDetail(name: string, args: Record<string, unknown>) {
  if (name === "shell") return String(args.command ?? args.cmd ?? "").slice(0, 240);
  if (name === "write_file") return String(args.path ?? "");
  if (name === "remember") return String(args.path ?? "MEMORY.md");
  if (name === "destination.write") return String(args.title ?? args.collection ?? "");
  if (name === "request_takeover") return String(args.reason ?? "");
  const first = Object.values(args).find((value) => typeof value === "string" && value.trim());
  return first ? String(first).slice(0, 240) : name;
}
