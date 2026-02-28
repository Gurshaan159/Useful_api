import fp from "fastify-plugin";
import { FastifyError, FastifyInstance } from "fastify";
import { ApiError, ApiErrorBody, ERROR_CODES } from "../lib/errors";

function toValidationDetails(error: unknown): unknown {
  if (!isFastifyError(error)) {
    return undefined;
  }
  return (error as FastifyError & { validation?: unknown }).validation;
}

function isFastifyError(error: unknown): error is FastifyError & { validation?: unknown } {
  return !!error && typeof error === "object" && "message" in error;
}

export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error, request, reply) => {
    if (isFastifyError(error) && error.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      const body: ApiErrorBody = {
        error: {
          code: ERROR_CODES.INVALID_JSON,
          message: "Malformed JSON body.",
          requestId: request.id,
        },
      };
      reply.status(400).send(body);
      return;
    }

    if (isFastifyError(error) && error.validation) {
      const body: ApiErrorBody = {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Request validation failed.",
          details: toValidationDetails(error),
          requestId: request.id,
        },
      };
      reply.status(400).send(body);
      return;
    }

    if (error instanceof ApiError) {
      const body: ApiErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      };
      reply.status(error.statusCode).send(body);
      return;
    }

    request.log.error({ err: error }, "Unhandled error");
    const body: ApiErrorBody = {
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "Internal server error.",
        requestId: request.id,
      },
    };
    reply.status(500).send(body);
  });
});
