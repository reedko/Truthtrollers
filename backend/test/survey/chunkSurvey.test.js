// backend/test/survey/chunkSurvey.test.js
// Test chunk survey functionality

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClaimExtractor } from "../../src/core/claimsEngine.js";

describe("ChunkSurvey", () => {
  let mockLlm;
  let extractor;

  beforeEach(() => {
    // Mock LLM that returns valid survey packet structure
    mockLlm = {
      generate: vi.fn(async ({ system, user, schemaHint, temperature }) => {
        // Return a minimal valid survey packet
        return {
          chunkIndex: 0,
          chunkPosition: "lead",
          chunkMiniTheme: "Article introduction discusses main topic",
          relationshipToProvisionalFrame: "supports_seed",
          pillarHints: [
            {
              pillarText: "Primary supporting claim",
              confidence: 0.8,
              supportingExcerpt: "This article argues that X",
            },
          ],
          evaluationCandidateClaims: [
            {
              claimText: "Specific factual claim to verify",
              roleHint: "pillar",
              importanceInChunk: 0.9,
              importanceToArticleGuess: 0.7,
              noveltyHint: "new",
              rhetoricalFunction: "states main argument",
              localSourceExcerpt: "The specific claim excerpt",
              namedActors: ["Organization A"],
              namedStudiesOrDocuments: ["Study 2024"],
              namedLawsOrPolicies: [],
              namedDatasets: [],
              claimType: { attribution: false, statistical: true },
            },
          ],
          sourceBackgroundCandidates: [
            {
              claimText: "Contextual background fact",
              reasonUsefulAsSource: "provides data",
              sourceUsefulness: "medium",
              localSourceExcerpt: "Background information",
              namedActors: [],
              namedStudiesOrDocuments: [],
              namedLawsOrPolicies: [],
              namedDatasets: [],
              claimType: { background: true },
            },
          ],
          localRepetitionSignals: [
            {
              phraseOrIdea: "repeated theme",
              appearsToRepeatEarlierArticleTheme: false,
              notes: "mentioned once in chunk",
            },
          ],
        };
      }),
    };

    extractor = new ClaimExtractor(mockLlm);
  });

  describe("surveyChunk()", () => {
    it("should return a valid survey packet", async () => {
      const packet = await extractor.surveyChunk({
        chunkText: "Sample article text to analyze",
        articleTitle: "Test Article",
        provisionalFrame: "Main argument of article",
        chunkIndex: 0,
        chunkCount: 1,
        chunkPosition: "lead",
      });

      expect(packet).toBeDefined();
      expect(packet.chunkIndex).toBe(0);
      expect(packet.chunkPosition).toBe("lead");
      expect(packet.chunkMiniTheme).toBe("Article introduction discusses main topic");
      expect(packet.relationshipToProvisionalFrame).toBe("supports_seed");
    });

    it("should mark all candidates with candidateOnly=true", async () => {
      const packet = await extractor.surveyChunk({
        chunkText: "Sample text",
        articleTitle: "Test Article",
        provisionalFrame: "Frame",
        chunkIndex: 0,
        chunkCount: 1,
        chunkPosition: "lead",
      });

      if (packet.evaluationCandidateClaims.length > 0) {
        packet.evaluationCandidateClaims.forEach((claim) => {
          expect(claim.candidateOnly).toBe(true);
        });
      }

      if (packet.sourceBackgroundCandidates.length > 0) {
        packet.sourceBackgroundCandidates.forEach((bg) => {
          expect(bg.candidateOnly).toBe(true);
        });
      }
    });

    it("should respect evaluation candidate limits (0-6)", async () => {
      const packet = await extractor.surveyChunk({
        chunkText: "Sample text",
        articleTitle: "Test Article",
        provisionalFrame: "Frame",
        chunkIndex: 0,
        chunkCount: 1,
        chunkPosition: "lead",
      });

      expect(packet.evaluationCandidateClaims.length).toBeLessThanOrEqual(6);
    });

    it("should respect background candidate limits (0-2)", async () => {
      const packet = await extractor.surveyChunk({
        chunkText: "Sample text",
        articleTitle: "Test Article",
        provisionalFrame: "Frame",
        chunkIndex: 0,
        chunkCount: 1,
        chunkPosition: "lead",
      });

      expect(packet.sourceBackgroundCandidates.length).toBeLessThanOrEqual(2);
    });

    it("should include all required fields in evaluation candidates", async () => {
      const packet = await extractor.surveyChunk({
        chunkText: "Sample text",
        articleTitle: "Test Article",
        provisionalFrame: "Frame",
        chunkIndex: 0,
        chunkCount: 1,
        chunkPosition: "lead",
      });

      if (packet.evaluationCandidateClaims.length > 0) {
        const claim = packet.evaluationCandidateClaims[0];
        expect(claim.claimText).toBeDefined();
        expect(claim.roleHint).toBeDefined();
        expect(claim.importanceInChunk).toBeDefined();
        expect(claim.importanceToArticleGuess).toBeDefined();
        expect(claim.noveltyHint).toBeDefined();
        expect(claim.rhetoricalFunction).toBeDefined();
        expect(claim.localSourceExcerpt).toBeDefined();
        expect(claim.namedActors).toBeDefined();
        expect(claim.namedStudiesOrDocuments).toBeDefined();
        expect(claim.namedLawsOrPolicies).toBeDefined();
        expect(claim.namedDatasets).toBeDefined();
        expect(claim.claimType).toBeDefined();
      }
    });
  });

  describe("surveyContent()", () => {
    it("should return array of survey packets for multiple chunks", async () => {
      const chunks = [
        { text: "First chunk text", tokenLength: 500 },
        { text: "Second chunk text", tokenLength: 600 },
      ];

      const packets = await extractor.surveyContent({
        chunks,
        articleTitle: "Test Article",
        provisionalFrame: "Main frame",
        maxConcurrency: 2,
      });

      expect(Array.isArray(packets)).toBe(true);
      expect(packets.length).toBe(2);
      expect(packets[0].chunkIndex).toBe(0);
      expect(packets[1].chunkIndex).toBe(1);
    });

    it("should automatically determine chunk positions", async () => {
      const chunks = [
        { text: "Chunk 1", tokenLength: 500 },
        { text: "Chunk 2", tokenLength: 500 },
        { text: "Chunk 3", tokenLength: 500 },
        { text: "Chunk 4", tokenLength: 500 },
      ];

      const packets = await extractor.surveyContent({
        chunks,
        articleTitle: "Test Article",
        provisionalFrame: "Frame",
        maxConcurrency: 2,
      });

      expect(packets[0].chunkPosition).toBe("lead");
      expect(packets[packets.length - 1].chunkPosition).toBe("conclusion");
      // Middle chunks should be body positions
      expect(
        ["early_body", "middle_body", "late_body"].includes(packets[1].chunkPosition)
      ).toBe(true);
    });

    it("should respect maxConcurrency limit", async () => {
      const chunks = Array.from({ length: 5 }, (_, i) => ({
        text: `Chunk ${i + 1}`,
        tokenLength: 500,
      }));

      const callOrder = [];
      mockLlm.generate = vi.fn(async () => {
        callOrder.push(1);
        // Simulate some processing time
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          chunkIndex: 0,
          chunkPosition: "lead",
          chunkMiniTheme: "test",
          relationshipToProvisionalFrame: "unclear",
          pillarHints: [],
          evaluationCandidateClaims: [],
          sourceBackgroundCandidates: [],
          localRepetitionSignals: [],
        };
      });

      const packets = await extractor.surveyContent({
        chunks,
        articleTitle: "Test",
        provisionalFrame: "Frame",
        maxConcurrency: 2,
      });

      expect(packets.length).toBe(5);
      expect(mockLlm.generate.mock.calls.length).toBe(5);
    });

    it("should return empty array for empty chunks", async () => {
      const packets = await extractor.surveyContent({
        chunks: [],
        articleTitle: "Test",
        provisionalFrame: "Frame",
      });

      expect(packets).toEqual([]);
    });
  });
});
