// backend/test/clustering/candidateClustering.test.js
// Test candidate clustering before final selection (Prompt 8)

import { test } from "node:test";
import assert from "node:assert";
import {
  clusterEvaluationCandidates,
  clusterBackgroundCandidates,
  clusterCandidatesFromSurvey,
  getClusteredRepresentatives,
} from "../../src/core/candidateClustering.js";

test("clusterEvaluationCandidates: clusters candidates with similar text", () => {
  const candidates = [
    {
      claimText: "The study shows that coffee improves memory",
      importanceInChunk: 0.8,
      importanceToArticleGuess: 0.6,
      noveltyHint: "novel",
      namedActors: [],
      namedStudiesOrDocuments: ["Memory Study 2024"],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    },
    {
      claimText: "A study demonstrates coffee enhances memory",
      importanceInChunk: 0.7,
      importanceToArticleGuess: 0.5,
      noveltyHint: "derivative",
      namedActors: [],
      namedStudiesOrDocuments: ["Memory Study 2024"],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    },
    {
      claimText: "Tea is beneficial for health",
      importanceInChunk: 0.6,
      importanceToArticleGuess: 0.4,
      noveltyHint: "novel",
      namedActors: [],
      namedStudiesOrDocuments: [],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    },
  ];

  const result = clusterEvaluationCandidates(candidates);

  // Should have 2 clusters (first two are similar, third is different)
  assert.strictEqual(result.clusters.size, 2);
  assert.strictEqual(result.totalClusters, 2);
  assert.strictEqual(result.clusterIdByIndex.length, 3);

  // First cluster should have 2 members
  const clusters = Array.from(result.clusters.values());
  const firstCluster = clusters.find((c) => c.size === 2);
  assert.ok(firstCluster);
  assert.ok(firstCluster.representative);
  assert.ok(firstCluster.representative.claimText.includes("coffee"));
});

test("clusterEvaluationCandidates: clusters candidates with same named study", () => {
  const candidates = [
    {
      claimText: "Study A found X",
      importanceInChunk: 0.5,
      importanceToArticleGuess: 0.3,
      noveltyHint: "novel",
      namedActors: [],
      namedStudiesOrDocuments: ["COVID-19 Vaccine Study"],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    },
    {
      claimText: "The vaccine research shows Y",
      importanceInChunk: 0.7,
      importanceToArticleGuess: 0.5,
      noveltyHint: "novel",
      namedActors: [],
      namedStudiesOrDocuments: ["COVID-19 Vaccine Study"],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    },
  ];

  const result = clusterEvaluationCandidates(candidates);

  assert.strictEqual(result.clusters.size, 1);
  const cluster = Array.from(result.clusters.values())[0];
  assert.strictEqual(cluster.size, 2);
  assert.ok(cluster.representative);
});

test("clusterEvaluationCandidates: clusters candidates with same named actor", () => {
  const candidates = [
    {
      claimText: "The WHO announced a new policy",
      importanceInChunk: 0.6,
      importanceToArticleGuess: 0.4,
      noveltyHint: "novel",
      namedActors: ["WHO"],
      namedStudiesOrDocuments: [],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    },
    {
      claimText: "WHO stated that guidelines have changed",
      importanceInChunk: 0.5,
      importanceToArticleGuess: 0.3,
      noveltyHint: "repeated",
      namedActors: ["WHO"],
      namedStudiesOrDocuments: [],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    },
  ];

  const result = clusterEvaluationCandidates(candidates);

  assert.strictEqual(result.clusters.size, 1);
});

test("clusterEvaluationCandidates: prefers novel over repeated despite lower importance", () => {
  const candidates = [
    {
      claimText: "Coffee improves memory",
      importanceInChunk: 0.3,
      importanceToArticleGuess: 0.2,
      noveltyHint: "novel",
      namedActors: [],
      namedStudiesOrDocuments: ["Study"],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    },
    {
      claimText: "Coffee enhances memory",
      importanceInChunk: 0.9,
      importanceToArticleGuess: 0.8,
      noveltyHint: "repeated",
      namedActors: [],
      namedStudiesOrDocuments: ["Study"],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    },
  ];

  const result = clusterEvaluationCandidates(candidates);

  const cluster = Array.from(result.clusters.values())[0];
  // Even though candidate 2 has higher importance, candidate 1 is selected
  // because it's marked as novel (not repeated), which is preferred
  assert.strictEqual(cluster.representative.noveltyHint, "novel");
  assert.strictEqual(cluster.representative.claimText, "Coffee improves memory");
});

test("clusterEvaluationCandidates: handles empty candidate list", () => {
  const result = clusterEvaluationCandidates([]);

  assert.deepStrictEqual(result.clusterIdByIndex, []);
  assert.strictEqual(result.clusters.size, 0);
  assert.strictEqual(result.totalClusters, 0);
});

test("clusterBackgroundCandidates: clusters candidates with same study", () => {
  const candidates = [
    {
      claimText: "Background context about X study",
      namedActors: [],
      namedStudiesOrDocuments: ["X Study 2024"],
      namedLawsOrPolicies: [],
      namedDatasets: [],
      localSourceExcerpt: "Study overview",
      importanceInChunk: 0.5,
      importanceToArticleGuess: 0.3,
    },
    {
      claimText: "Additional context from X research",
      namedActors: [],
      namedStudiesOrDocuments: ["X Study 2024"],
      namedLawsOrPolicies: [],
      namedDatasets: [],
      localSourceExcerpt: "Additional information",
      importanceInChunk: 0.4,
      importanceToArticleGuess: 0.2,
    },
  ];

  const result = clusterBackgroundCandidates(candidates);

  assert.strictEqual(result.clusters.size, 1);
  const cluster = Array.from(result.clusters.values())[0];
  assert.strictEqual(cluster.size, 2);
});

test("clusterBackgroundCandidates: clusters candidates with same actor", () => {
  const candidates = [
    {
      claimText: "WHO recommends X",
      namedActors: ["WHO"],
      namedStudiesOrDocuments: [],
      namedLawsOrPolicies: [],
      namedDatasets: [],
      localSourceExcerpt: "WHO statement",
      importanceInChunk: 0.5,
      importanceToArticleGuess: 0.3,
    },
    {
      claimText: "WHO also supports Y",
      namedActors: ["WHO"],
      namedStudiesOrDocuments: [],
      namedLawsOrPolicies: [],
      namedDatasets: [],
      localSourceExcerpt: "WHO statement",
      importanceInChunk: 0.4,
      importanceToArticleGuess: 0.2,
    },
  ];

  const result = clusterBackgroundCandidates(candidates);

  assert.strictEqual(result.clusters.size, 1);
});

test("clusterBackgroundCandidates: handles empty candidate list", () => {
  const result = clusterBackgroundCandidates([]);

  assert.deepStrictEqual(result.clusterIdByIndex, []);
  assert.strictEqual(result.clusters.size, 0);
  assert.strictEqual(result.totalClusters, 0);
});

test("clusterCandidatesFromSurvey: processes survey results and clusters candidates", () => {
  const surveyResults = {
    chunkSurveys: [
      {
        chunkIndex: 0,
        chunkPosition: "lead",
        chunkMiniTheme: "Introduction",
        evaluationCandidateClaims: [
          {
            claimText: "Study shows coffee helps memory",
            importanceInChunk: 0.8,
            importanceToArticleGuess: 0.6,
            noveltyHint: "novel",
            namedActors: [],
            namedStudiesOrDocuments: ["Coffee Memory Study"],
            namedLawsOrPolicies: [],
            namedDatasets: [],
          },
          {
            claimText: "Research indicates coffee improves memory",
            importanceInChunk: 0.7,
            importanceToArticleGuess: 0.5,
            noveltyHint: "derivative",
            namedActors: [],
            namedStudiesOrDocuments: ["Coffee Memory Study"],
            namedLawsOrPolicies: [],
            namedDatasets: [],
          },
        ],
        sourceBackgroundCandidates: [
          {
            claimText: "Study methodology",
            importanceInChunk: 0.5,
            importanceToArticleGuess: 0.3,
            namedActors: [],
            namedStudiesOrDocuments: ["Coffee Memory Study"],
            namedLawsOrPolicies: [],
            namedDatasets: [],
            localSourceExcerpt: "Methodology section",
          },
        ],
      },
    ],
    totalChunks: 1,
    totalEvaluationCandidates: 2,
    totalBackgroundCandidates: 1,
  };

  const result = clusterCandidatesFromSurvey(surveyResults);

  assert.ok(result.clusteringMetrics);
  assert.strictEqual(result.clusteringMetrics.evaluationCandidatesProcessed, 2);
  assert.strictEqual(result.clusteringMetrics.evaluationClusters, 1);
  assert.strictEqual(result.clusteringMetrics.evaluationRepresentatives, 1);
  assert.strictEqual(result.clusteringMetrics.backgroundCandidatesProcessed, 1);
  assert.strictEqual(result.clusteringMetrics.backgroundClusters, 1);
  assert.strictEqual(result.clusteringMetrics.backgroundRepresentatives, 1);
});

test("clusterCandidatesFromSurvey: handles empty survey results", () => {
  const surveyResults = {
    chunkSurveys: [],
    totalChunks: 0,
    totalEvaluationCandidates: 0,
    totalBackgroundCandidates: 0,
  };

  const result = clusterCandidatesFromSurvey(surveyResults);

  assert.strictEqual(result.clusteringMetrics.evaluationCandidatesProcessed, 0);
  assert.strictEqual(result.clusteringMetrics.evaluationClusters, 0);
  assert.strictEqual(result.clusteringMetrics.backgroundCandidatesProcessed, 0);
  assert.strictEqual(result.clusteringMetrics.backgroundClusters, 0);
});

test("clusterCandidatesFromSurvey: preserves chunk metadata", () => {
  const surveyResults = {
    chunkSurveys: [
      {
        chunkIndex: 1,
        chunkPosition: "middle_body",
        chunkMiniTheme: "Main argument",
        evaluationCandidateClaims: [
          {
            claimText: "Claim in chunk 1",
            importanceInChunk: 0.8,
            importanceToArticleGuess: 0.6,
            noveltyHint: "novel",
            namedActors: [],
            namedStudiesOrDocuments: [],
            namedLawsOrPolicies: [],
            namedDatasets: [],
          },
        ],
        sourceBackgroundCandidates: [],
      },
    ],
    totalChunks: 1,
    totalEvaluationCandidates: 1,
    totalBackgroundCandidates: 0,
  };

  const result = clusterCandidatesFromSurvey(surveyResults);

  const evalReps = result.evaluationClusterResults.representatives;
  assert.strictEqual(evalReps[0].sourceChunkIndex, 1);
  assert.strictEqual(evalReps[0].sourceChunkPosition, "middle_body");
  assert.strictEqual(evalReps[0].chunkMiniTheme, "Main argument");
});

test("getClusteredRepresentatives: returns sorted representatives", () => {
  const clusteringOutput = {
    evaluationClusterResults: {
      representatives: [
        {
          claimText: "Low importance claim",
          importanceInChunk: 0.2,
          importanceToArticleGuess: 0.1,
        },
        {
          claimText: "High importance claim",
          importanceInChunk: 0.9,
          importanceToArticleGuess: 0.8,
        },
      ],
    },
    backgroundClusterResults: {
      representatives: [
        {
          claimText: "Background fact",
          importanceInChunk: 0.4,
          importanceToArticleGuess: 0.3,
        },
      ],
    },
  };

  const result = getClusteredRepresentatives(clusteringOutput);

  assert.strictEqual(result.evaluationRepresentatives.length, 2);
  assert.strictEqual(result.backgroundRepresentatives.length, 1);
  assert.strictEqual(result.allRepresentatives.length, 3);

  // High importance should come first
  assert.ok(result.allRepresentatives[0].claimText.includes("High importance"));
});

test("getClusteredRepresentatives: handles missing results gracefully", () => {
  const result = getClusteredRepresentatives({});

  assert.deepStrictEqual(result.evaluationRepresentatives, []);
  assert.deepStrictEqual(result.backgroundRepresentatives, []);
  assert.deepStrictEqual(result.allRepresentatives, []);
});

test("clusterEvaluationCandidates: calculates reduction ratios", () => {
  // Create 10 similar candidates
  const candidates = Array(10)
    .fill(null)
    .map((_, i) => ({
      claimText: "Repeated claim from multiple chunks",
      importanceInChunk: 0.5,
      importanceToArticleGuess: 0.3,
      noveltyHint: "repeated",
      namedActors: [],
      namedStudiesOrDocuments: ["Same Study"],
      namedLawsOrPolicies: [],
      namedDatasets: [],
    }));

  const result = clusterEvaluationCandidates(candidates);

  // All 10 similar claims should cluster into fewer representatives
  assert.ok(result.totalClusters < 10);
  assert.strictEqual(result.clusters.size, 1); // Should all be in one cluster
});
