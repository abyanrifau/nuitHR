/** Database errors are already written for people; strip technical prefixes. */
export function friendly(message: string): string {
  return message.replace(/^.*?ERROR:\s*/i, "").replace(/\s*\(SQLSTATE.*\)$/, "");
}

export interface ActionResult {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}
