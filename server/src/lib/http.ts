export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The input field the error is about, so the form can mark it in red. */
    public field?: string,
  ) {
    super(message);
  }
}
