/** Remove cercas de código ("```json ... ```") que alguns modelos acrescentam. */
export function stripCodeFence(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  return fenced?.[1] ?? text.trim();
}
