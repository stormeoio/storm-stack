/** Outcome for project wiring that must be present before installation succeeds. */
export interface RequiredWiringResult {
  /** The project file was changed by this operation. */
  modified: boolean;
  /** The required wiring is present after the operation. */
  configured: boolean;
  reason?: string;
}
