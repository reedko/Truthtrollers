export interface Cf7HarvestRequest {
  chunkId: string;
  chunkIndex: number;
  chunkCount: number;
  unitIds: string[];
  text: string;
}

export interface Cf7HarvestResult {
  disputedAssertions: Array<{
    assertionText: string;
    groundingUnitIds: string[];
  }>;
  assertions: Array<{
    assertionText: string;
    groundingUnitIds: string[];
  }>;
}
