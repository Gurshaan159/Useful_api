export const ERROR_CODES = {
  INVALID_JSON: "INVALID_JSON",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_RANGE: "INVALID_RANGE",
  AMBIGUOUS_PLAYER: "AMBIGUOUS_PLAYER",
  NOT_FOUND: "NOT_FOUND",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class ApiError extends Error {
  public readonly statusCode: number;

  public readonly code: ErrorCode;

  public readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class InvalidRequestError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(422, ERROR_CODES.INVALID_REQUEST, message, details);
  }
}

export class InvalidRangeError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(422, ERROR_CODES.INVALID_RANGE, message, details);
  }
}

export class AmbiguousPlayerError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(409, ERROR_CODES.AMBIGUOUS_PLAYER, message, details);
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(404, ERROR_CODES.NOT_FOUND, message, details);
  }
}

export class UpstreamError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(502, ERROR_CODES.UPSTREAM_ERROR, message, details);
  }
}

export class UpstreamTimeoutError extends ApiError {
  constructor(message: string, details?: unknown) {
    super(504, ERROR_CODES.UPSTREAM_TIMEOUT, message, details);
  }
}
