// dashboard/src/components/modals/CredibilityInfoModal.tsx
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
  Tooltip,
  IconButton,
} from "@chakra-ui/react";
import { useEffect, useState, useRef } from "react";
import { RepeatIcon } from "@chakra-ui/icons";
import { useAuthStore } from "../../store/useAuthStore";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

interface CredibilityInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: "author" | "publisher";
  entityId: number;
  entityName: string;
}

interface CredibilityResult {
  checked_at?: string;
  services?: {
    opensanctions?: {
      source: string;
      entity_type?: string;
      search_term?: string;
      has_matches: boolean;
      match_count: number;
      highest_score?: number;
      risk_level: string;
      risk_reasons?: string[];
      matches?: Array<{
        entity_id: string;
        name: string;
        score: number;
        datasets: string[];
        countries?: string[];
        topics?: string[];
      }>;
      error?: string;
    };
    gdi?: {
      source: string;
      domain?: string;
      score?: number;
      risk_level: string;
      categories?: string[];
      flags?: string[];
      error?: string;
    };
  };
  overall_risk?: {
    level: string;
    score: number;
    reasons: string[];
  };
}

const CredibilityInfoModal: React.FC<CredibilityInfoModalProps> = ({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityName,
}) => {
  const { colorMode } = useColorMode();
  const token = useAuthStore((s) => s.token);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<CredibilityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasAutoChecked = useRef(false);

  useEffect(() => {
    if (isOpen) {
      hasAutoChecked.current = false; // Reset on open
      loadHistory();
    }
  }, [isOpen, entityId]);

  const loadHistory = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/credibility/${entityType}/${entityId}/history`,
        {
          credentials: "include",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        // If history endpoint fails, likely tables don't exist yet
        // Just set result to null and let user run a manual check
        console.warn("Failed to load history, tables may not exist yet");
        setResult(null);
        setIsLoading(false);
        return;
      }

      const history = await response.json();

      if (history && history.length > 0) {
        // Convert history array to result format
        const latestCheck = history[0];
        setResult({
          checked_at: latestCheck.checked_at,
          services: {
            opensanctions: {
              source: latestCheck.source,
              has_matches: latestCheck.has_matches || false,
              match_count: latestCheck.match_count || 0,
              highest_score: latestCheck.highest_score,
              risk_level: latestCheck.risk_level,
              risk_reasons: latestCheck.risk_reasons ? JSON.parse(latestCheck.risk_reasons) : [],
              matches: latestCheck.matches ? JSON.parse(latestCheck.matches) : [],
            },
          },
        });
      } else {
        // No history - automatically run a check (only once)
        setResult(null);
        setIsLoading(false);
        // Automatically run check if no history exists and we haven't auto-checked yet
        if (!hasAutoChecked.current) {
          hasAutoChecked.current = true;
          await runCheck();
        }
      }
    } catch (err) {
      console.error("Error loading credibility history:", err);
      // Don't show error, just let user run manual check
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  const runCheck = async () => {
    setIsChecking(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/credibility/${entityType}/${entityId}/check`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || `Failed to check credibility (${response.status})`;
        console.error("Check credibility failed:", response.status, errorData);
        throw new Error(errorMsg);
      }

      const newResult = await response.json();
      setResult(newResult);
    } catch (err) {
      console.error("Error checking credibility:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsChecking(false);
    }
  };

  const getRiskColor = (level?: string) => {
    switch (level) {
      case "critical":
        return "red";
      case "high":
        return "orange";
      case "medium":
        return "yellow";
      case "low":
        return "green";
      case "none":
        return "gray";
      default:
        return "gray";
    }
  };

  const getRiskLabel = (level?: string) => {
    switch (level) {
      case "critical":
        return "🔴 Critical Risk";
      case "high":
        return "🟠 High Risk";
      case "medium":
        return "🟡 Medium Risk";
      case "low":
        return "🟢 Low Risk";
      case "none":
        return "✅ No Risk Found";
      default:
        return "❓ Unknown";
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent
        bg={colorMode === "dark" ? "gray.800" : "white"}
        maxH="90vh"
      >
        <ModalHeader>
          <VStack align="start" spacing={1}>
            <Text>Credibility Check</Text>
            <Text fontSize="sm" fontWeight="normal" color="gray.500">
              {entityType === "author" ? "Author" : "Publisher"}: {entityName}
            </Text>
          </VStack>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>
          {isLoading ? (
            <Box textAlign="center" py={8}>
              <Spinner size="xl" color="teal.400" />
              <Text mt={4} color="gray.500">
                Loading history...
              </Text>
            </Box>
          ) : error ? (
            <Alert status="error">
              <AlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : (
            <VStack align="stretch" spacing={4}>
              {/* Status Header */}
              <Box
                p={4}
                bg={colorMode === "dark" ? "gray.700" : "gray.50"}
                borderRadius="md"
              >
                <HStack justify="space-between" mb={2}>
                  <Text fontSize="sm" color="gray.500">
                    Last Checked
                  </Text>
                  <Tooltip label="Run a new check">
                    <IconButton
                      aria-label="Refresh check"
                      icon={<RepeatIcon />}
                      size="sm"
                      onClick={runCheck}
                      isLoading={isChecking}
                      colorScheme="teal"
                    />
                  </Tooltip>
                </HStack>
                <Text fontSize="sm" fontWeight="semibold">
                  {formatDate(result?.checked_at)}
                </Text>
              </Box>

              {!result ? (
                <Alert status="info">
                  <AlertIcon />
                  <Box>
                    <AlertDescription>
                      No credibility checks found for this {entityType}.
                      <br />
                      Click the refresh button above to run a check.
                    </AlertDescription>
                  </Box>
                </Alert>
              ) : (
                <>
                  {/* Overall Risk */}
                  {result.overall_risk && (
                    <Box
                      p={4}
                      bg={colorMode === "dark" ? "gray.700" : "gray.50"}
                      borderRadius="md"
                      borderWidth="2px"
                      borderColor={`${getRiskColor(result.overall_risk.level)}.400`}
                    >
                      <Text fontSize="sm" color="gray.500" mb={2}>
                        Overall Risk Assessment
                      </Text>
                      <Badge
                        colorScheme={getRiskColor(result.overall_risk.level)}
                        fontSize="md"
                        px={3}
                        py={1}
                      >
                        {getRiskLabel(result.overall_risk.level)}
                      </Badge>
                      {result.overall_risk.reasons && result.overall_risk.reasons.length > 0 && (
                        <VStack align="start" mt={3} spacing={1}>
                          {result.overall_risk.reasons.map((reason, i) => (
                            <Text key={i} fontSize="xs" color="gray.500">
                              • {reason}
                            </Text>
                          ))}
                        </VStack>
                      )}
                    </Box>
                  )}

                  {/* OpenSanctions Results */}
                  {result.services?.opensanctions && (
                    <Box>
                      <HStack mb={3}>
                        <Badge colorScheme="purple">OpenSanctions</Badge>
                        <Text fontSize="sm" color="gray.500">
                          Sanctions, PEPs & Watchlists
                        </Text>
                      </HStack>

                      {result.services.opensanctions.error ? (
                        <Alert status="warning" size="sm">
                          <AlertIcon />
                          <AlertDescription>
                            {result.services.opensanctions.error}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <VStack align="stretch" spacing={3}>
                          <HStack>
                            <Text fontSize="sm" fontWeight="semibold">
                              Risk Level:
                            </Text>
                            <Badge colorScheme={getRiskColor(result.services.opensanctions.risk_level)}>
                              {getRiskLabel(result.services.opensanctions.risk_level)}
                            </Badge>
                          </HStack>

                          {result.services.opensanctions.has_matches ? (
                            <>
                              <Text fontSize="sm" color="orange.500" fontWeight="semibold">
                                ⚠️ {result.services.opensanctions.match_count} match(es) found
                              </Text>

                              {result.services.opensanctions.matches && result.services.opensanctions.matches.length > 0 && (
                                <VStack align="stretch" spacing={2} mt={2}>
                                  {result.services.opensanctions.matches.map((match, i) => (
                                    <Box
                                      key={i}
                                      p={3}
                                      bg={colorMode === "dark" ? "gray.700" : "gray.50"}
                                      borderRadius="md"
                                      borderLeftWidth="3px"
                                      borderLeftColor="orange.400"
                                    >
                                      <Text fontSize="sm" fontWeight="semibold" mb={1}>
                                        {match.name}
                                      </Text>
                                      <Text fontSize="xs" color="gray.500" mb={2}>
                                        Match Score: {Math.round(match.score * 100)}%
                                      </Text>
                                      {match.datasets && match.datasets.length > 0 && (
                                        <HStack spacing={1} wrap="wrap">
                                          {match.datasets.map((dataset, j) => (
                                            <Badge key={j} fontSize="xs" colorScheme="red">
                                              {dataset}
                                            </Badge>
                                          ))}
                                        </HStack>
                                      )}
                                      {match.countries && match.countries.length > 0 && (
                                        <Text fontSize="xs" color="gray.500" mt={1}>
                                          Countries: {match.countries.join(", ")}
                                        </Text>
                                      )}
                                    </Box>
                                  ))}
                                </VStack>
                              )}
                            </>
                          ) : (
                            <Alert status="success" size="sm">
                              <AlertIcon />
                              <AlertDescription>
                                ✅ No matches found in sanctions, PEP, or watchlist databases
                              </AlertDescription>
                            </Alert>
                          )}
                        </VStack>
                      )}
                    </Box>
                  )}

                  {/* GDI Results (for publishers only) */}
                  {entityType === "publisher" && result.services?.gdi && (
                    <Box>
                      <Divider my={4} />
                      <HStack mb={3}>
                        <Badge colorScheme="blue">GDI</Badge>
                        <Text fontSize="sm" color="gray.500">
                          Global Disinformation Index
                        </Text>
                      </HStack>

                      {result.services.gdi.error ? (
                        <Alert status="info" size="sm">
                          <AlertIcon />
                          <AlertDescription>
                            {result.services.gdi.error === "not_configured"
                              ? "GDI API not configured yet"
                              : result.services.gdi.error}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <VStack align="stretch" spacing={3}>
                          <HStack>
                            <Text fontSize="sm" fontWeight="semibold">
                              Credibility Score:
                            </Text>
                            <Badge
                              colorScheme={getRiskColor(result.services.gdi.risk_level)}
                              fontSize="md"
                            >
                              {result.services.gdi.score || "N/A"}
                            </Badge>
                          </HStack>
                          <Text fontSize="xs" color="gray.500">
                            Score Range: 0 (lowest) - 100 (highest)
                          </Text>
                        </VStack>
                      )}
                    </Box>
                  )}
                </>
              )}
            </VStack>
          )}
        </ModalBody>

        <ModalFooter>
          <Button onClick={onClose}>Close</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default CredibilityInfoModal;
