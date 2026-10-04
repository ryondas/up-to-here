export function friendlyError(error: unknown, area: "chat" | "shows") {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLocaleLowerCase();
  if (lower.includes("quota") || lower.includes("rate limit") || lower.includes("429") || lower.includes("resource_exhausted")) {
    return "That AI provider is at its request limit. Wait a moment, or check its plan and usage page.";
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("api key") || lower.includes("unauthorized")) {
    return "That API key was rejected. Check the key and provider, then try again.";
  }
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("networkerror")) {
    return "Couldn’t reach the service. Check your connection and try again.";
  }
  if (area === "shows") return "Couldn’t load that show’s episode data. Try another show or come back shortly.";
  return "The answer couldn’t be generated right now. Please try again.";
}
