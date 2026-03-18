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
  Input,
} from "@chakra-ui/react";
import { useEffect, useState, useRef } from "react";
import { RepeatIcon } from "@chakra-ui/icons";
import { useAuthStore } from "../../store/useAuthStore";
import LegalCaseDetailModal from "./LegalCaseDetailModal";

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
    courtlistener?: {
      source: string;
      entity_type?: string;
      entity_name?: string;
      has_cases: boolean;
      case_count: number;
      cases?: Array<{
        case_name: string;
        court: string;
        date_filed: string;
        docket_number?: string;
        description?: string;
        url?: string;
        page_type?: string;
        case_type?: string;
        nature_of_suit?: string;
        complaint?: {
          date: string;
          description: string;
          document_url?: string;
        };
        verdict?: {
          date: string;
          description: string;
          document_url?: string;
        };
        judgment?: {
          date: string;
          description: string;
          document_url?: string;
        };
        readable_summary?: string;
        parties?: Array<{
          name: string;
          type: string;
        }>;
      }>;
      risk_level: string;
      risk_reasons?: string[];
      error?: string;
    };
    cfpb?: {
      source: string;
      entity_type?: string;
      entity_name?: string;
      has_complaints: boolean;
      complaint_count: number;
      complaints?: Array<{
        complaint_id: string;
        product: string;
        issue: string;
        company_response: string;
        date_received: string;
      }>;
      statistics?: {
        disputed_percentage: number;
        untimely_percentage: number;
      };
      risk_level: string;
      risk_reasons?: string[];
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

  // State for Legal Case Detail Modal
  const [selectedCaseUrl, setSelectedCaseUrl] = useState<string | null>(null);
  const [selectedCaseName, setSelectedCaseName] = useState<string>("");
  const [isCaseDetailOpen, setIsCaseDetailOpen] = useState(false);
  const [casesDisplayLimit, setCasesDisplayLimit] = useState(10); // Start with 10, load more in batches
  const [caseFilter, setCaseFilter] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      hasAutoChecked.current = false; // Reset on open
      loadHistory();
    }
  }, [isOpen, entityId]);

  const loadHistory = async () => {
    setIsLoading(true);
    setError(null);

    console.log(`🔍 [CredibilityModal] Loading history for ${entityType} ${entityId}`);

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

      console.log(`🔍 [CredibilityModal] History response status: ${response.status}`);

      if (!response.ok) {
        // If history endpoint fails, likely tables don't exist yet
        // Just set result to null and let user run a manual check
        console.warn("❌ [CredibilityModal] Failed to load history, tables may not exist yet");
        setResult(null);
        setIsLoading(false);
        return;
      }

      const history = await response.json();
      console.log(`🔍 [CredibilityModal] History loaded: ${history.length} records`);

      if (history && history.length > 0) {
        console.log('📋 Loading cached credibility results:', history);

        // Reconstruct result from ALL cached services
        const services: any = {};

        for (const check of history) {
          const source = check.source?.toLowerCase();

          if (source === 'opensanctions') {
            services.opensanctions = {
              source: check.source,
              has_matches: check.has_matches || false,
              match_count: check.match_count || 0,
              highest_score: check.highest_score,
              risk_level: check.risk_level,
              risk_reasons: check.risk_reasons ? JSON.parse(check.risk_reasons) : [],
              matches: check.matches ? JSON.parse(check.matches) : [],
            };
          } else if (source === 'courtlistener') {
            const cases = check.matches ? JSON.parse(check.matches) : [];
            console.log('📋 Loading CourtListener from cache (check_id: ' + check.check_id + '):', {
              has_matches: check.has_matches,
              match_count: check.match_count,
              matches_raw: check.matches ? check.matches.substring(0, 100) : null,
              cases_parsed_count: cases.length,
              checked_at: check.checked_at,
            });

            // Only set courtlistener if we have cases OR if it's not already set
            // This ensures we use the entry with cases if one exists
            if (!services.courtlistener || cases.length > 0) {
              services.courtlistener = {
                source: check.source,
                entity_type: entityType,
                entity_name: entityName,
                has_cases: check.has_matches || false,
                case_count: check.match_count || 0,
                cases: cases,
                risk_level: check.risk_level || 'none',
                risk_reasons: check.risk_reasons ? JSON.parse(check.risk_reasons) : [],
              };
              console.log('✅ Set courtlistener service with ' + cases.length + ' cases');
            } else {
              console.log('⏭️ Skipping empty courtlistener entry (already have one with cases)');
            }
          } else if (source === 'cfpb') {
            services.cfpb = {
              source: check.source,
              entity_type: entityType,
              entity_name: entityName,
              has_complaints: check.has_matches || false,
              complaint_count: check.match_count || 0,
              complaints: check.matches ? JSON.parse(check.matches) : [],
              risk_level: check.risk_level || 'none',
              risk_reasons: check.risk_reasons ? JSON.parse(check.risk_reasons) : [],
            };
          }
        }

        // Use the most recent checked_at date
        const latestDate = history[0].checked_at;

        setResult({
          checked_at: latestDate,
          services,
        });

        console.log('✅ Cached result loaded with services:', Object.keys(services));
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

  const runCheck = async (force: boolean = false) => {
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
          body: JSON.stringify({ force }), // Pass force parameter
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
                  <Tooltip label="Force refresh - bypass cache and run new check">
                    <IconButton
                      aria-label="Refresh check"
                      icon={<RepeatIcon />}
                      size="sm"
                      onClick={() => runCheck(true)} // Force refresh
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

                  {/* CourtListener Results */}
                  {result.services?.courtlistener && (
                    <Box>
                      <Divider my={4} />
                      <HStack mb={3}>
                        <Badge colorScheme="purple">CourtListener</Badge>
                        <Text fontSize="sm" color="gray.500">
                          Free Law Project
                        </Text>
                      </HStack>

                      {result.services.courtlistener.error ? (
                        <Alert status="info" size="sm">
                          <AlertIcon />
                          <AlertDescription>
                            {result.services.courtlistener.error === "not_configured"
                              ? "CourtListener API not configured"
                              : result.services.courtlistener.error}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <VStack align="stretch" spacing={3}>
                          <HStack>
                            <Text fontSize="sm" fontWeight="semibold">
                              Risk Level:
                            </Text>
                            <Badge colorScheme={getRiskColor(result.services.courtlistener.risk_level)}>
                              {getRiskLabel(result.services.courtlistener.risk_level)}
                            </Badge>
                          </HStack>
                          {result.services.courtlistener.has_cases ? (
                            <>
                              <Text fontSize="sm">
                                ⚖️ {result.services.courtlistener.case_count} court case(s) found
                              </Text>

                              {/* Case filter input */}
                              {result.services.courtlistener.cases && result.services.courtlistener.cases.length > 5 && (
                                <Input
                                  size="sm"
                                  placeholder="Filter cases by name..."
                                  value={caseFilter}
                                  onChange={(e) => setCaseFilter(e.target.value)}
                                  mb={2}
                                />
                              )}

                              {result.services.courtlistener.cases && result.services.courtlistener.cases.length > 0 && (() => {
                                // Apply filter
                                const filteredCases = caseFilter
                                  ? result.services.courtlistener.cases.filter((c: any) =>
                                      c.case_name?.toLowerCase().includes(caseFilter.toLowerCase()) ||
                                      c.court?.toLowerCase().includes(caseFilter.toLowerCase()) ||
                                      c.description?.toLowerCase().includes(caseFilter.toLowerCase())
                                    )
                                  : result.services.courtlistener.cases;

                                const displayedCases = filteredCases.slice(0, casesDisplayLimit);

                                return (
                                <VStack align="stretch" spacing={3} pl={4}>
                                  {displayedCases.length === 0 && (
                                    <Text fontSize="sm" color="gray.500">No cases match filter</Text>
                                  )}
                                  {displayedCases.map((caseData: any, i: number) => (
                                    <Box
                                      key={i}
                                      fontSize="xs"
                                      borderLeft="3px"
                                      borderColor="purple.400"
                                      pl={3}
                                      py={2}
                                      cursor="pointer"
                                      onClick={() => {
                                        if (caseData.url) {
                                          setSelectedCaseUrl(caseData.url);
                                          setSelectedCaseName(caseData.case_name);
                                          setIsCaseDetailOpen(true);
                                        }
                                      }}
                                      _hover={{
                                        bg: colorMode === "dark" ? "gray.700" : "purple.50",
                                        borderColor: "purple.500"
                                      }}
                                      transition="all 0.2s"
                                      borderRadius="md"
                                      p={2}
                                    >
                                      {/* Case Name & Type */}
                                      <HStack spacing={2} mb={1}>
                                        <Text fontWeight="bold" fontSize="sm">{caseData.case_name}</Text>
                                        {caseData.case_type && (
                                          <Badge size="xs" colorScheme={caseData.case_type === 'criminal' ? 'red' : 'blue'}>
                                            {caseData.case_type}
                                          </Badge>
                                        )}
                                        {caseData.page_type && (
                                          <Badge size="xs" variant="outline">{caseData.page_type}</Badge>
                                        )}
                                      </HStack>

                                      {/* Court & Date */}
                                      <Text color={colorMode === "dark" ? "gray.400" : "gray.500"} fontSize="xs" mb={2}>
                                        {caseData.court && !caseData.court.includes('http') ? caseData.court : 'Federal Court'} • {caseData.date_filed || 'Date unknown'}
                                      </Text>

                                      {/* Enhanced Data: Complaint, Verdict, Judgment */}
                                      {caseData.nature_of_suit && (
                                        <Text fontSize="xs" mb={1}>
                                          <Text as="span" fontWeight="semibold">Nature: </Text>
                                          {caseData.nature_of_suit}
                                        </Text>
                                      )}

                                      {caseData.complaint && (
                                        <Box bg="yellow.50" p={2} borderRadius="md" mb={1}>
                                          <Text fontSize="xs" fontWeight="semibold" color="yellow.700">
                                            📄 Complaint ({caseData.complaint.date})
                                          </Text>
                                          <Text fontSize="xs" color="yellow.900">
                                            {caseData.complaint.description}
                                          </Text>
                                        </Box>
                                      )}

                                      {caseData.verdict && (
                                        <Box bg="blue.50" p={2} borderRadius="md" mb={1}>
                                          <Text fontSize="xs" fontWeight="semibold" color="blue.700">
                                            ⚖️ Verdict ({caseData.verdict.date})
                                          </Text>
                                          <Text fontSize="xs" color="blue.900">
                                            {caseData.verdict.description}
                                          </Text>
                                        </Box>
                                      )}

                                      {caseData.judgment && (
                                        <Box bg="green.50" p={2} borderRadius="md" mb={1}>
                                          <Text fontSize="xs" fontWeight="semibold" color="green.700">
                                            ⚖️ Judgment ({caseData.judgment.date})
                                          </Text>
                                          <Text fontSize="xs" color="green.900">
                                            {caseData.judgment.description}
                                          </Text>
                                        </Box>
                                      )}

                                      {/* Fallback to description if no enhanced data */}
                                      {!caseData.complaint && !caseData.verdict && !caseData.judgment && caseData.description && (
                                        <Text mt={1} fontSize="xs" color={colorMode === "dark" ? "gray.400" : "gray.600"}>
                                          {caseData.description.length > 200 ? caseData.description.slice(0, 200) + '...' : caseData.description}
                                        </Text>
                                      )}

                                      {/* Show docket number if available */}
                                      {caseData.docket_number && (
                                        <Text fontSize="xs" color={colorMode === "dark" ? "gray.500" : "gray.600"} mt={1}>
                                          Docket: {caseData.docket_number}
                                        </Text>
                                      )}

                                      {/* Show readable summary if available - strip markdown */}
                                      {caseData.readable_summary && (
                                        <Text fontSize="xs" color={colorMode === "dark" ? "gray.400" : "gray.600"} mt={1} whiteSpace="pre-line">
                                          {caseData.readable_summary.replace(/\*\*/g, '').replace(/\n\n/g, '\n')}
                                        </Text>
                                      )}

                                      {/* Click indicator */}
                                      {caseData.url && (
                                        <Text fontSize="xs" mt={2} color="purple.500" fontWeight="semibold">
                                          Click for details →
                                        </Text>
                                      )}
                                    </Box>
                                  ))}

                                  {/* Load More Buttons */}
                                  {filteredCases.length > casesDisplayLimit && (
                                    <HStack spacing={2} mt={2}>
                                      <Button
                                        size="sm"
                                        colorScheme="purple"
                                        variant="outline"
                                        onClick={() => setCasesDisplayLimit(casesDisplayLimit + 10)}
                                      >
                                        Load 10 More ({Math.min(10, filteredCases.length - casesDisplayLimit)} cases)
                                      </Button>
                                      {filteredCases.length > casesDisplayLimit + 10 && (
                                        <Button
                                          size="sm"
                                          colorScheme="purple"
                                          variant="outline"
                                          onClick={() => setCasesDisplayLimit(casesDisplayLimit + 100)}
                                        >
                                          Load 100 More
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        colorScheme="purple"
                                        onClick={() => setCasesDisplayLimit(filteredCases.length)}
                                      >
                                        Show All ({filteredCases.length - casesDisplayLimit} remaining)
                                      </Button>
                                    </HStack>
                                  )}
                                  {casesDisplayLimit > 10 && (
                                    <Button
                                      size="sm"
                                      colorScheme="purple"
                                      variant="outline"
                                      onClick={() => setCasesDisplayLimit(10)}
                                      mt={2}
                                    >
                                      Show Less (reset to 10)
                                    </Button>
                                  )}
                                </VStack>
                                );
                              })()}
                            </>
                          ) : (
                            <Text fontSize="sm" color="green.500">✓ No court cases found</Text>
                          )}
                        </VStack>
                      )}
                    </Box>
                  )}

                  {/* CFPB Results */}
                  {result.services?.cfpb && (
                    <Box>
                      <Divider my={4} />
                      <HStack mb={3}>
                        <Badge colorScheme="orange">CFPB</Badge>
                        <Text fontSize="sm" color="gray.500">
                          Consumer Financial Protection Bureau
                        </Text>
                      </HStack>

                      {result.services.cfpb.error ? (
                        <Alert status="info" size="sm">
                          <AlertIcon />
                          <AlertDescription>
                            {result.services.cfpb.error}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <VStack align="stretch" spacing={3}>
                          <HStack>
                            <Text fontSize="sm" fontWeight="semibold">
                              Risk Level:
                            </Text>
                            <Badge colorScheme={getRiskColor(result.services.cfpb.risk_level)}>
                              {getRiskLabel(result.services.cfpb.risk_level)}
                            </Badge>
                          </HStack>
                          {result.services.cfpb.has_complaints ? (
                            <>
                              <Text fontSize="sm">
                                💰 {result.services.cfpb.complaint_count} consumer complaint(s)
                              </Text>
                              {result.services.cfpb.statistics && (
                                <VStack align="stretch" fontSize="xs" spacing={1}>
                                  <Text>• {result.services.cfpb.statistics.disputed_percentage}% of complaints disputed</Text>
                                  <Text>• {result.services.cfpb.statistics.untimely_percentage}% untimely responses</Text>
                                </VStack>
                              )}
                              {result.services.cfpb.complaints && result.services.cfpb.complaints.length > 0 && (
                                <VStack align="stretch" spacing={2} pl={4}>
                                  <Text fontSize="xs" fontWeight="semibold">Recent Complaints:</Text>
                                  {result.services.cfpb.complaints.slice(0, 3).map((complaint, i) => (
                                    <Box key={i} fontSize="xs" borderLeft="2px" borderColor="orange.400" pl={3}>
                                      <Text fontWeight="semibold">{complaint.product}</Text>
                                      <Text color="gray.500">{complaint.issue}</Text>
                                      <Text mt={1}>Response: {complaint.company_response}</Text>
                                    </Box>
                                  ))}
                                </VStack>
                              )}
                            </>
                          ) : (
                            <Text fontSize="sm" color="green.500">✓ No consumer complaints found</Text>
                          )}
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

      {/* Legal Case Detail Modal */}
      <LegalCaseDetailModal
        isOpen={isCaseDetailOpen}
        onClose={() => setIsCaseDetailOpen(false)}
        caseUrl={selectedCaseUrl || ""}
        caseName={selectedCaseName}
      />
    </Modal>
  );
};

export default CredibilityInfoModal;
