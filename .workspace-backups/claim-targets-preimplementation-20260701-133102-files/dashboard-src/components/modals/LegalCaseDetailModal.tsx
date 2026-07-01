// dashboard/src/components/modals/LegalCaseDetailModal.tsx
// Modal for displaying detailed legal case information
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Button,
  VStack,
  HStack,
  Text,
  Badge,
  Box,
  Spinner,
  Alert,
  AlertIcon,
  AlertDescription,
  useColorMode,
  Divider,
  Link,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { ExternalLinkIcon } from "@chakra-ui/icons";
import { useAuthStore } from "../../store/useAuthStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface LegalCaseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseUrl: string;
  caseName: string;
}

interface CaseDetails {
  case_level: string;
  case_type: string;
  case_name: string;
  court: string;
  date_filed: string;
  docket_number?: string;
  nature_of_suit?: string;
  cause?: string;
  parties?: Array<{
    name: string;
    type: string;
  }>;
  complaint?: {
    entry_number: number;
    date: string;
    description: string;
    document_url?: string;
  };
  verdict?: {
    entry_number: number;
    date: string;
    description: string;
    document_url?: string;
  };
  judgment?: {
    entry_number: number;
    date: string;
    description: string;
    document_url?: string;
  };
  readable_summary?: string;
  url: string;
  raw_docket?: any;
  raw_clusters?: any[];
  raw_entries?: any[];
  clusters?: any[];
}

const LegalCaseDetailModal: React.FC<LegalCaseDetailModalProps> = ({
  isOpen,
  onClose,
  caseUrl,
  caseName,
}) => {
  const { colorMode } = useColorMode();
  const token = useAuthStore((s) => s.token);
  const [isLoading, setIsLoading] = useState(false);
  const [details, setDetails] = useState<CaseDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && caseUrl) {
      fetchCaseDetails();
    }
  }, [isOpen, caseUrl]);

  const fetchCaseDetails = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/credibility/legal-case/details`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ caseUrl }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch case details (${response.status})`);
      }

      const data = await response.json();

      if (data.error) {
        setError(data.message || data.error);
      } else {
        setDetails(data);
      }
    } catch (err: any) {
      console.error("Error fetching case details:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="4xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent bg={colorMode === "dark" ? "gray.800" : "white"}>
        <ModalHeader>
          <HStack spacing={2}>
            <Text>Legal Case Details</Text>
            {details?.case_type && (
              <Badge colorScheme={details.case_type === "criminal" ? "red" : "blue"}>
                {details.case_type}
              </Badge>
            )}
            {details?.case_level && (
              <Badge variant="outline">{details.case_level}</Badge>
            )}
          </HStack>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>
          {isLoading ? (
            <VStack spacing={4} py={8}>
              <Spinner size="xl" color="purple.500" />
              <Text>Loading case details...</Text>
            </VStack>
          ) : error ? (
            <Alert status="error">
              <AlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : details ? (
            <VStack align="stretch" spacing={4}>
              {/* Case Name */}
              <Box>
                <Text fontSize="2xl" fontWeight="bold">{details.case_name}</Text>
                <Text fontSize="sm" color="gray.500">
                  {details.court} • {details.date_filed}
                  {details.docket_number && ` • Docket: ${details.docket_number}`}
                </Text>
              </Box>

              <Divider />

              {/* Nature of Suit / Cause */}
              {(details.nature_of_suit || details.cause) && (
                <Box>
                  {details.nature_of_suit && (
                    <Text fontSize="sm">
                      <Text as="span" fontWeight="semibold">Nature of Suit: </Text>
                      {details.nature_of_suit}
                    </Text>
                  )}
                  {details.cause && (
                    <Text fontSize="sm" mt={1}>
                      <Text as="span" fontWeight="semibold">Legal Cause: </Text>
                      {details.cause}
                    </Text>
                  )}
                </Box>
              )}

              {/* Parties */}
              {details.parties && details.parties.length > 0 && (
                <Box>
                  <Text fontWeight="semibold" mb={2}>Parties:</Text>
                  <VStack align="stretch" spacing={1} pl={4}>
                    {details.parties.slice(0, 6).map((party, i) => (
                      <HStack key={i} spacing={2}>
                        <Badge size="sm" colorScheme={party.type.toLowerCase().includes("plaintiff") ? "green" : "red"}>
                          {party.type}
                        </Badge>
                        <Text fontSize="sm">{party.name}</Text>
                      </HStack>
                    ))}
                    {details.parties.length > 6 && (
                      <Text fontSize="xs" color="gray.500">
                        ...and {details.parties.length - 6} more
                      </Text>
                    )}
                  </VStack>
                </Box>
              )}

              <Divider />

              {/* Complaint */}
              {details.complaint && (
                <Box bg="yellow.50" p={4} borderRadius="md" borderLeft="4px" borderColor="yellow.400">
                  <HStack mb={2}>
                    <Text fontSize="lg" fontWeight="bold" color="yellow.700">
                      📄 Complaint
                    </Text>
                    <Text fontSize="sm" color="gray.600">
                      {details.complaint.date}
                    </Text>
                  </HStack>
                  <Text fontSize="sm" color="yellow.900">
                    {details.complaint.description}
                  </Text>
                  {details.complaint.document_url && (
                    <Link
                      href={details.complaint.document_url}
                      isExternal
                      fontSize="xs"
                      color="yellow.700"
                      mt={2}
                      display="block"
                    >
                      View document <ExternalLinkIcon mx="2px" />
                    </Link>
                  )}
                </Box>
              )}

              {/* Verdict */}
              {details.verdict && (
                <Box bg="blue.50" p={4} borderRadius="md" borderLeft="4px" borderColor="blue.400">
                  <HStack mb={2}>
                    <Text fontSize="lg" fontWeight="bold" color="blue.700">
                      ⚖️ Verdict
                    </Text>
                    <Text fontSize="sm" color="gray.600">
                      {details.verdict.date}
                    </Text>
                  </HStack>
                  <Text fontSize="sm" color="blue.900">
                    {details.verdict.description}
                  </Text>
                  {details.verdict.document_url && (
                    <Link
                      href={details.verdict.document_url}
                      isExternal
                      fontSize="xs"
                      color="blue.700"
                      mt={2}
                      display="block"
                    >
                      View document <ExternalLinkIcon mx="2px" />
                    </Link>
                  )}
                </Box>
              )}

              {/* Judgment */}
              {details.judgment && (
                <Box bg="green.50" p={4} borderRadius="md" borderLeft="4px" borderColor="green.400">
                  <HStack mb={2}>
                    <Text fontSize="lg" fontWeight="bold" color="green.700">
                      ⚖️ Judgment
                    </Text>
                    <Text fontSize="sm" color="gray.600">
                      {details.judgment.date}
                    </Text>
                  </HStack>
                  <Text fontSize="sm" color="green.900">
                    {details.judgment.description}
                  </Text>
                  {details.judgment.document_url && (
                    <Link
                      href={details.judgment.document_url}
                      isExternal
                      fontSize="xs"
                      color="green.700"
                      mt={2}
                      display="block"
                    >
                      View document <ExternalLinkIcon mx="2px" />
                    </Link>
                  )}
                </Box>
              )}

              {/* Readable Summary */}
              {details.readable_summary && !details.complaint && !details.verdict && !details.judgment && (
                <Box
                  bg={colorMode === "dark" ? "gray.700" : "gray.50"}
                  p={4}
                  borderRadius="md"
                >
                  <Text fontWeight="semibold" mb={2}>Summary:</Text>
                  <Text fontSize="sm" whiteSpace="pre-wrap">
                    {details.readable_summary}
                  </Text>
                </Box>
              )}

              {/* No detailed data available */}
              {!details.complaint && !details.verdict && !details.judgment && !details.readable_summary && (
                <Alert status="info">
                  <AlertIcon />
                  <AlertDescription>
                    Detailed case information not available. This may be an opinion document or
                    the case data hasn't been parsed yet.
                  </AlertDescription>
                </Alert>
              )}

              <Divider />

              <Divider />

              {/* EXTRACTED KEY INFO - What we're looking for */}
              <Box
                bg={colorMode === "dark" ? "blue.900" : "blue.50"}
                p={4}
                borderRadius="md"
              >
                <Text
                  fontWeight="bold"
                  fontSize="lg"
                  mb={3}
                  color={colorMode === "dark" ? "blue.200" : "blue.800"}
                >
                  📋 Key Case Information:
                </Text>

                {/* Show Syllabus (case summary) */}
                {details.clusters && details.clusters.length > 0 && details.clusters.some((c: any) => c.syllabus) && (
                  <Box mb={3}>
                    <Text
                      fontWeight="bold"
                      color={colorMode === "dark" ? "blue.300" : "blue.700"}
                    >
                      Case Summary (Syllabus):
                    </Text>
                    {details.clusters.map((cluster: any, i: number) => cluster.syllabus && (
                      <Text
                        key={i}
                        fontSize="sm"
                        color={colorMode === "dark" ? "gray.200" : "gray.800"}
                        mt={2}
                      >
                        {cluster.syllabus}
                      </Text>
                    ))}
                  </Box>
                )}

                {/* Show Disposition */}
                {details.clusters && details.clusters.length > 0 && details.clusters.some((c: any) => c.disposition) && (
                  <Box mb={3}>
                    <Text
                      fontWeight="bold"
                      color={colorMode === "dark" ? "green.300" : "green.700"}
                    >
                      Court Decision (Disposition):
                    </Text>
                    {details.clusters.map((cluster: any, i: number) => cluster.disposition && (
                      <Text
                        key={i}
                        fontSize="sm"
                        color={colorMode === "dark" ? "gray.200" : "gray.800"}
                        mt={2}
                      >
                        {cluster.disposition}
                      </Text>
                    ))}
                  </Box>
                )}

                {/* Show headnotes */}
                {details.clusters && details.clusters.length > 0 && details.clusters.some((c: any) => c.headnotes) && (
                  <Box mb={3}>
                    <Text
                      fontWeight="bold"
                      color={colorMode === "dark" ? "purple.300" : "purple.700"}
                    >
                      Legal Headnotes:
                    </Text>
                    {details.clusters.map((cluster: any, i: number) => cluster.headnotes && (
                      <Text
                        key={i}
                        fontSize="sm"
                        color={colorMode === "dark" ? "gray.200" : "gray.800"}
                        mt={2}
                      >
                        {cluster.headnotes}
                      </Text>
                    ))}
                  </Box>
                )}

                {/* Show ALL_DOCKETS info */}
                {(details as any).all_dockets && (details as any).all_dockets.length > 0 && (
                  <Box mb={3}>
                    <Text
                      fontWeight="bold"
                      color={colorMode === "dark" ? "orange.300" : "orange.700"}
                    >
                      Dockets Found: {(details as any).all_dockets.length}
                    </Text>
                    {(details as any).all_dockets.map((docket: any, i: number) => (
                      <Box
                        key={i}
                        p={2}
                        bg={colorMode === "dark" ? "gray.800" : "white"}
                        borderRadius="md"
                        mt={2}
                      >
                        <Text
                          fontSize="xs"
                          color={colorMode === "dark" ? "gray.300" : "gray.700"}
                        >
                          <strong>Docket {i + 1}:</strong> Filed {docket.date_filed || 'unknown'} - {docket.nature_of_suit || 'No nature of suit'}
                        </Text>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              {/* RAW CLUSTERS DATA - Collapsed by default */}
              {details.raw_clusters && details.raw_clusters.length > 0 && (
                <Box
                  bg={colorMode === "dark" ? "purple.900" : "purple.50"}
                  p={4}
                  borderRadius="md"
                  maxH="400px"
                  overflowY="auto"
                >
                  <Text
                    fontWeight="bold"
                    mb={2}
                    color={colorMode === "dark" ? "purple.200" : "purple.800"}
                  >
                    📚 Clusters ({details.raw_clusters.length}):
                  </Text>
                  {details.raw_clusters.map((cluster: any, i: number) => (
                    <Box
                      key={i}
                      mb={4}
                      p={3}
                      bg={colorMode === "dark" ? "gray.800" : "white"}
                      borderRadius="md"
                    >
                      <Text
                        fontSize="xs"
                        fontWeight="bold"
                        color={colorMode === "dark" ? "gray.200" : "gray.800"}
                      >
                        Cluster {i + 1}:
                      </Text>
                      <Box
                        as="pre"
                        fontSize="xs"
                        whiteSpace="pre-wrap"
                        fontFamily="monospace"
                        color={colorMode === "dark" ? "gray.300" : "gray.800"}
                      >
                        {JSON.stringify(cluster, null, 2)}
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}

              {/* RAW DATA SECTION - For debugging */}
              <Box
                bg={colorMode === "dark" ? "gray.900" : "gray.100"}
                p={4}
                borderRadius="md"
                maxH="400px"
                overflowY="auto"
              >
                <Text
                  fontWeight="bold"
                  mb={2}
                  color={colorMode === "dark" ? "gray.200" : "gray.800"}
                >
                  🔍 Full Raw API Data:
                </Text>
                <Box
                  as="pre"
                  fontSize="xs"
                  whiteSpace="pre-wrap"
                  fontFamily="monospace"
                  color={colorMode === "dark" ? "gray.300" : "gray.800"}
                >
                  {JSON.stringify(details, null, 2)}
                </Box>
              </Box>
            </VStack>
          ) : (
            <Alert status="info">
              <AlertIcon />
              <AlertDescription>No case details available.</AlertDescription>
            </Alert>
          )}
        </ModalBody>

        <ModalFooter>
          {details?.url && (
            <Button
              as="a"
              href={details.url}
              target="_blank"
              rel="noopener noreferrer"
              leftIcon={<ExternalLinkIcon />}
              colorScheme="purple"
              mr={3}
            >
              View on CourtListener
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default LegalCaseDetailModal;
