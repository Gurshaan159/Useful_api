import { FastifyInstance } from "fastify";
import { SituationRepository } from "../../repositories/situation-repository";
import { Situation, SituationInputs } from "../../domain/situation";
import {
  createSituationBodySchema,
  createSituationResponseSchema,
  CreateSituationRequestBody,
  normalizeCreateSituationInputs,
} from "./situations.schemas";

interface PostSituationsDeps {
  situationBuilder: {
    build(inputs: SituationInputs): Promise<Situation>;
  };
  situationRepository: SituationRepository;
}

export async function registerPostSituationsRoute(
  app: FastifyInstance,
  deps: PostSituationsDeps,
): Promise<void> {
  app.post<{ Body: CreateSituationRequestBody }>(
    "/v1/situations",
    {
      schema: {
        body: createSituationBodySchema,
        response: createSituationResponseSchema,
      },
    },
    async (request, reply) => {
      const normalizedInputs = normalizeCreateSituationInputs(request.body);
      const situation = await deps.situationBuilder.build(normalizedInputs);
      await deps.situationRepository.create(situation);
      reply.code(201).send({
        id: situation.id,
        gamesScanned: situation.meta.gamesScanned,
        gamesUsed: situation.meta.gamesUsed,
      });
    },
  );
}
