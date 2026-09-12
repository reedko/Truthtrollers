import React from "react";
import {
  Badge, Box, Button, Divider, HStack, Link, Modal, ModalBody,
  ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay,
  SimpleGrid, Text, VStack,
} from "@chakra-ui/react";
import { ExternalLinkIcon, RepeatIcon } from "@chakra-ui/icons";
import type { TraceSupportResponse, TraceSupportSource } from "./traceSupportClient";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  result: TraceSupportResponse;
  evidenceClaimId: number;
  isRefreshing: boolean;
  onRefresh: () => void;
}

function DestinationLink({ href, children, warning = false }: {
  href?: string | null;
  children: React.ReactNode;
  warning?: boolean;
}) {
  if (!href) return null;
  return (
    <Button
      as={Link}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      size="sm"
      variant="outline"
      colorScheme={warning ? "red" : "cyan"}
      rightIcon={<ExternalLinkIcon />}
      textDecoration="none"
      _hover={{ textDecoration: "none" }}
    >
      {children}
    </Button>
  );
}

function SourceDetail({ source, ordinal }: { source: TraceSupportSource; ordinal: number }) {
  const identity = source.locator?.scholarlyIdentity;
  const notice = source.locator?.publicationNotice;
  const citedUrl = source.locator?.originalUrl || source.sourceUrl;
  const publicationUrl = identity?.canonicalUrl || source.child?.url;
  const relatedRetraction = source.publicationStatus === "related_work_retracted";
  const retracted = source.publicationStatus === "retracted" || source.child?.isRetracted;
  const title = identity?.identity?.title || source.child?.title || source.sourceLabel || "Identified supporting source";
  const titleMatch = typeof identity?.titleAgreement === "number"
    ? `${Math.round(identity.titleAgreement * 100)}% title match`
    : null;

  return (
    <Box border="1px solid" borderColor={relatedRetraction || retracted ? "red.500" : "whiteAlpha.300"} bg="whiteAlpha.50" borderRadius="xl" overflow="hidden">
      <Box px={5} py={4} bg="rgba(0, 162, 255, 0.08)">
        <HStack justify="space-between" align="start" spacing={3}>
          <Box>
            <Text fontSize="10px" color="cyan.300" letterSpacing="0.12em" textTransform="uppercase">Supporting source {ordinal}</Text>
            <Text mt={1} fontSize="md" fontWeight="bold" color="cyan.50">{title}</Text>
            {identity?.identity?.author && <Text mt={1} fontSize="sm" color="gray.400">{identity.identity.author}</Text>}
          </Box>
          <Badge colorScheme={source.resolutionStatus === "resolved" || source.resolutionStatus === "acquired" ? "green" : source.resolutionStatus === "failed" ? "red" : "yellow"}>
            {source.resolutionStatus.replace(/_/g, " ")}
          </Badge>
        </HStack>
      </Box>

      <VStack align="stretch" spacing={4} px={5} py={4}>
        {source.explanation && (
          <Box>
            <Text fontSize="xs" fontWeight="bold" color="gray.400" textTransform="uppercase">Why this source was found</Text>
            <Text mt={1} fontSize="sm" color="gray.200">{source.explanation}</Text>
          </Box>
        )}
        {source.citationText && (
          <Box borderLeft="3px solid" borderColor="cyan.500" pl={3}>
            <Text fontSize="xs" fontWeight="bold" color="gray.400" textTransform="uppercase">Citation context in the evidence document</Text>
            <Text mt={1} fontSize="sm" fontStyle="italic" color="gray.300">{source.citationText}</Text>
          </Box>
        )}
        {identity?.matchKind === "related" && (
          <Box p={3} border="1px solid" borderColor="orange.400" bg="rgba(237, 137, 54, 0.1)" borderRadius="lg">
            <HStack spacing={2}><Badge colorScheme="orange">Related scholarly work</Badge>{titleMatch && <Badge colorScheme="orange" variant="outline">{titleMatch}</Badge>}</HStack>
            <Text mt={2} fontSize="sm" color="orange.100">The cited PDF title did not produce an exact PubMed match. A same-author, overlapping publication was found:</Text>
            <Text mt={1} fontSize="sm" fontWeight="bold" color="orange.50">{identity.title}</Text>
          </Box>
        )}
        {(relatedRetraction || retracted) && (
          <Box p={3} border="1px solid" borderColor="red.400" bg="rgba(245, 101, 101, 0.12)" borderRadius="lg">
            <Text fontWeight="bold" color="red.200">{relatedRetraction ? "Reliability warning: related publication retracted" : "Retraction warning"}</Text>
            {relatedRetraction && <Text mt={1} fontSize="sm" color="red.100">This applies to the related PubMed publication. It does not automatically mean the cited PDF was retracted.</Text>}
            {notice?.reason && <Text mt={2} fontSize="sm" color="red.100">{notice.reason}</Text>}
          </Box>
        )}
        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
          {(source.pmid || source.doi) && <Box><Text fontSize="xs" color="gray.500">Publication identifiers</Text>{source.pmid && <Text fontSize="sm">PMID {source.pmid}</Text>}{source.doi && <Text fontSize="sm">DOI {source.doi}</Text>}</Box>}
          {source.locator?.sourceLineage?.lineageType && source.locator.sourceLineage.lineageType !== "unknown" && <Box><Text fontSize="xs" color="gray.500">Source lineage</Text><Text fontSize="sm">{source.locator.sourceLineage.lineageType.replace(/_/g, " ")}{source.locator.sourceLineage.chainDepth ? ` · ${source.locator.sourceLineage.chainDepth} upstream hop(s)` : ""}</Text></Box>}
        </SimpleGrid>
        <Divider borderColor="whiteAlpha.200" />
        <HStack spacing={3} flexWrap="wrap">
          <DestinationLink href={citedUrl}>Open cited PDF</DestinationLink>
          <DestinationLink href={publicationUrl}>Open journal record</DestinationLink>
          <DestinationLink href={notice?.url} warning>Open retraction notice</DestinationLink>
        </HStack>
      </VStack>
    </Box>
  );
}

export default function SupportProvenanceModal({ isOpen, onClose, result, evidenceClaimId, isRefreshing, onRefresh }: Props) {
  const cannotDetermine = result.sources.length === 1 && result.sources[0].resolutionStatus === "cannot_determine";
  const createdAt = result.sources[0]?.createdAt;
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" isCentered scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.800" backdropFilter="blur(3px)" zIndex={3900} />
      <ModalContent containerProps={{ zIndex: 4000 }} bg="#0d1728" color="white" border="1px solid" borderColor="cyan.700" boxShadow="0 24px 80px rgba(0,0,0,0.75)">
        <ModalHeader pr={14}><Text color="cyan.100">Support Provenance</Text><Text mt={1} fontSize="xs" fontWeight="normal" color="gray.400">Assertion #{evidenceClaimId} · one-hop source trace{createdAt ? ` · saved ${new Date(createdAt).toLocaleString()}` : ""}</Text></ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {cannotDetermine ? <Box p={4} bg="whiteAlpha.100" borderRadius="lg"><Text color="gray.200">{result.sources[0].explanation || "The evidence document does not identify a supporting source for this assertion."}</Text></Box> : <VStack align="stretch" spacing={5}>{result.sources.map((source, index) => <SourceDetail key={source.traceId} source={source} ordinal={index + 1} />)}</VStack>}
        </ModalBody>
        <ModalFooter borderTop="1px solid" borderColor="whiteAlpha.200">
          <HStack w="100%" justify="space-between"><Text fontSize="xs" color="gray.500">Saved provenance remains available when this document is reopened.</Text><Button size="sm" variant="outline" colorScheme="cyan" leftIcon={<RepeatIcon />} onClick={onRefresh} isLoading={isRefreshing} loadingText="Tracing">Refresh trace</Button></HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
