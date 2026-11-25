/**
 * Catalog of user-facing error codes. Messages are written for end users and
 * never contain secrets, tokens, file system paths or upstream response bodies.
 */
export const ERRORS = {
  UNSUPPORTED_URL: { status: 400, message: "That link isn't a supported Instagram post, reel or video URL." },
  VALIDATION: { status: 400, message: "Some of the submitted information is invalid." },
  AUTH_REQUIRED: { status: 401, message: "Please sign in to continue." },
  INVALID_CREDENTIALS: { status: 401, message: "Incorrect username or password." },
  CSRF: { status: 403, message: "Your request could not be verified. Refresh the page and try again." },
  FORBIDDEN: { status: 403, message: "You don't have permission to do that." },
  REGISTRATION_CLOSED: { status: 403, message: "Registration is closed on this server." },
  NOT_FOUND: { status: 404, message: "Not found." },
  CONFLICT: { status: 409, message: "That already exists." },
  TOO_LARGE: { status: 413, message: "The file is larger than the allowed limit." },
  UNSUPPORTED_FILE: { status: 415, message: "That file type isn't supported." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please wait a moment and try again." },
  NOT_CONNECTED: {
    status: 409,
    message:
      "No Instagram account is connected. Connect your Instagram professional account, or import your Instagram data export to access your own media.",
  },
  INSTAGRAM_NOT_CONFIGURED: {
    status: 501,
    message: "Instagram API credentials aren't configured on this server. Use the archive importer instead, or ask the administrator to add Meta app credentials.",
  },
  TOKEN_EXPIRED: { status: 401, message: "Your Instagram connection has expired. Please reconnect your account." },
  PRIVATE_MEDIA_REQUIRES_AUTHORIZATION: {
    status: 403,
    message:
      "This media isn't owned by any Instagram account you've connected. Private media can only be accessed by its owner. If the owner has shared the file with you, add it with “Add files you were given”.",
  },
  API_UNSUPPORTED: {
    status: 422,
    message:
      "Instagram's official API doesn't support this operation. Use the archive importer for your own stories and other content.",
  },
  MEDIA_UNAVAILABLE: {
    status: 404,
    message: "The media is unavailable. It may have been deleted, or Instagram withheld the file (for example, due to a copyright claim).",
  },
  UPSTREAM_ERROR: { status: 502, message: "Instagram returned an unexpected error. Please try again later." },
  PROCESSING_FAILED: { status: 500, message: "Temporary processing failure. Please try again." },
  INVALID_ARCHIVE: { status: 422, message: "The archive is invalid or contains unsafe entries." },
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${ERRORS[code].message} ${detail}` : ERRORS[code].message);
    this.code = code;
    this.status = ERRORS[code].status;
    this.detail = detail;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Message safe to show users and persist in history. */
export function publicMessage(e: unknown): { code: ErrorCode; message: string } {
  if (isAppError(e)) return { code: e.code, message: e.message };
  return { code: "PROCESSING_FAILED", message: ERRORS.PROCESSING_FAILED.message };
}
