import React from "react";
import { Box, Grid, HStack, Link, Stat, StatLabel, StatNumber, Text, VStack } from "@chakra-ui/react";
import { PublisherContext } from "./types";

interface PublisherRatingGraphicProps {
  context?: PublisherContext | null;
}

const hasValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== "";

const ContextItem: React.FC<{ label: string; value?: React.ReactNode; href?: string | null }> = ({ label, value, href }) => (
  <Box
    border="1px solid var(--mr-glass-border)"
    bg="rgba(255,255,255,0.045)"
    borderRadius="var(--mr-radius-sm)"
    p={3}
    minH="76px"
  >
    <Text fontSize="10px" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.06em">
      {label}
    </Text>
    {href ? (
      <Link href={href} isExternal color="var(--mr-blue)" fontSize="sm">
        {value || "Available"}
      </Link>
    ) : (
      <Text color="var(--mr-text-primary)" fontSize="sm" noOfLines={3}>
        {value || "Not available"}
      </Text>
    )}
  </Box>
);

const PublisherRatingGraphic: React.FC<PublisherRatingGraphicProps> = ({ context }) => {
  if (!context || !Object.values(context).some(hasValue)) return null;

  return (
    <Box className="mr-card mr-card-green" p={4}>
      <VStack align="stretch" spacing={4}>
        <HStack justify="space-between" align="start">
          <Box>
            <Text fontSize="xs" color="var(--mr-green)" textTransform="uppercase" letterSpacing="0.08em">
              External Publisher Context
            </Text>
            <Text color="var(--mr-text-primary)" fontWeight={700}>
              {context.name || "Publisher context"}
            </Text>
          </Box>
          {hasValue(context.veristrata_score) && (
            <Stat textAlign="right" maxW="150px">
              <StatLabel color="var(--mr-text-muted)" fontSize="xs">VeriStrata</StatLabel>
              <StatNumber color="var(--mr-green)" fontSize="xl">{context.veristrata_score}</StatNumber>
            </Stat>
          )}
        </HStack>

        <Grid templateColumns={{ base: "1fr", md: "repeat(3, minmax(0, 1fr))" }} gap={3}>
          <ContextItem
            label="Wikipedia"
            value={context.wikipedia_summary}
            href={context.wikipedia_url}
          />
          <ContextItem
            label="Media Bias/Fact Check"
            value={[context.mbfc_bias, context.mbfc_factual].filter(hasValue).join(" / ")}
            href={context.mbfc_url}
          />
          <ContextItem
            label="Ad Fontes"
            value={[context.adfontes_bias, context.adfontes_reliability].filter(hasValue).join(" / ")}
            href={context.adfontes_url}
          />
        </Grid>

        <Text color="var(--mr-text-muted)" fontSize="xs">
          External context is displayed as background signal only, not as VeriStrata's conclusion about this review.
        </Text>
      </VStack>
    </Box>
  );
};

export default PublisherRatingGraphic;
