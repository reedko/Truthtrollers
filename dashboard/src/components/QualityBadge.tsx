// src/components/QualityBadge.tsx
import { Badge, Tooltip, HStack, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { api } from "../services/api";

interface QualityBadgeProps {
  contentId: number;
  showScore?: boolean; // Show numeric score (0-10)
  size?: "sm" | "md" | "lg";
}

interface QualityScores {
  quality_score: number;
  risk_score: number;
  quality_tier: 'high' | 'mid' | 'low' | 'unreliable';
  author_transparency?: number;
  publisher_transparency?: number;
  evidence_density?: number;
  domain_reputation?: number;
}

const QualityBadge: React.FC<QualityBadgeProps> = ({
  contentId,
  showScore = true,
  size = "sm"
}) => {
  const [scores, setScores] = useState<QualityScores | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchQuality = async () => {
      try {
        const response = await api.get(`/api/claims/quality-scores/${contentId}`);
        setScores(response.data);
      } catch (err) {
        // No quality scores available - that's okay
        setScores(null);
      } finally {
        setLoading(false);
      }
    };

    fetchQuality();
  }, [contentId]);

  if (loading) {
    return null; // Don't show anything while loading
  }

  if (!scores) {
    return null; // No quality scores available
  }

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'high': return 'green';
      case 'mid': return 'blue';
      case 'low': return 'orange';
      case 'unreliable': return 'red';
      default: return 'gray';
    }
  };

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'high': return 'High Quality';
      case 'mid': return 'Medium Quality';
      case 'low': return 'Low Quality';
      case 'unreliable': return 'Unreliable';
      default: return 'Unknown';
    }
  };

  const tooltipContent = (
    <div>
      <div><strong>Quality Score:</strong> {scores.quality_score}/10</div>
      <div><strong>Risk Score:</strong> {scores.risk_score}/10</div>
      {scores.author_transparency !== undefined && (
        <div><strong>Author Transparency:</strong> {scores.author_transparency}/10</div>
      )}
      {scores.publisher_transparency !== undefined && (
        <div><strong>Publisher Transparency:</strong> {scores.publisher_transparency}/10</div>
      )}
      {scores.evidence_density !== undefined && (
        <div><strong>Evidence Density:</strong> {scores.evidence_density}/10</div>
      )}
      {scores.domain_reputation !== undefined && (
        <div><strong>Domain Reputation:</strong> {scores.domain_reputation}/10</div>
      )}
    </div>
  );

  return (
    <Tooltip label={tooltipContent} placement="top" hasArrow>
      <HStack spacing={1}>
        <Badge
          colorScheme={getTierColor(scores.quality_tier)}
          fontSize={size === "sm" ? "xs" : size === "md" ? "sm" : "md"}
          px={2}
          py={0.5}
          borderRadius="md"
        >
          {getTierLabel(scores.quality_tier)}
        </Badge>
        {showScore && (
          <Text
            fontSize={size === "sm" ? "xs" : size === "md" ? "sm" : "md"}
            fontWeight="bold"
            color={getTierColor(scores.quality_tier) + ".400"}
          >
            {scores.quality_score}/10
          </Text>
        )}
      </HStack>
    </Tooltip>
  );
};

export default QualityBadge;
