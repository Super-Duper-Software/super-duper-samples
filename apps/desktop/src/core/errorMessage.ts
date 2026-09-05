/** The message of a thrown value, whatever it turned out to be. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
