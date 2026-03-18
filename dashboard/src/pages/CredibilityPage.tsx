import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Heading,
  VStack,
  HStack,
  Input,
  Button,
  Select,
  Text,
  Badge,
  Card,
  CardBody,
  Grid,
  useToast,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Spinner,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Divider,
  Link,
  Icon,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  useDisclosure,
} from '@chakra-ui/react';
import { FiSearch, FiUser, FiFileText, FiAlertCircle, FiCheckCircle, FiExternalLink } from 'react-icons/fi';
import { api } from '../services/api';
import type { Author, Publisher } from '../../../shared/entities/types';

const API_BASE_URL = import.meta.env.VITE_BASE_URL || 'https://localhost:5001';

interface CredibilityResult {
  checked_at: string;
  services: {
    [key: string]: any;
  };
  overall_risk: {
    level: string;
    score: number;
    flags: string[];
    reasons: string[];
  };
}

const CredibilityPage: React.FC = () => {
  const toast = useToast();
  const { isOpen: isCasesModalOpen, onOpen: onOpenCasesModal, onClose: onCloseCasesModal } = useDisclosure();
  const { isOpen: isSanctionsModalOpen, onOpen: onOpenSanctionsModal, onClose: onCloseSanctionsModal } = useDisclosure();
  const { isOpen: isCaseDetailModalOpen, onOpen: onOpenCaseDetailModal, onClose: onCloseCaseDetailModal } = useDisclosure();

  // State
  const [authors, setAuthors] = useState<Author[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<any>(null);
  const [selectedCases, setSelectedCases] = useState<any[]>([]);
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [selectedSanctions, setSelectedSanctions] = useState<any[]>([]);

  // Selection state
  const [selectedAuthor, setSelectedAuthor] = useState<number | null>(null);
  const [selectedPublisher, setSelectedPublisher] = useState<number | null>(null);
  const [customName, setCustomName] = useState('');
  const [customType, setCustomType] = useState<'author' | 'publisher'>('author');

  // Results
  const [authorResult, setAuthorResult] = useState<CredibilityResult | null>(null);
  const [publisherResult, setPublisherResult] = useState<CredibilityResult | null>(null);

  useEffect(() => {
    loadData();
    loadServiceStatus();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load authors
      const authorsRes = await api.get(`${API_BASE_URL}/api/authors`);
      if (authorsRes.data) {
        setAuthors(authorsRes.data);
      }

      // Load publishers
      const publishersRes = await api.get(`${API_BASE_URL}/api/publishers`);
      if (publishersRes.data) {
        setPublishers(publishersRes.data);
      }
    } catch (error: any) {
      toast({
        title: 'Failed to load data',
        description: error.message,
        status: 'error',
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadServiceStatus = async () => {
    try {
      const res = await api.get(`${API_BASE_URL}/api/credibility/service-status`);
      if (res.data) {
        setServiceStatus(res.data);
      }
    } catch (error) {
      console.error('Failed to load service status:', error);
    }
  };

  const checkAuthorCredibility = async (authorId?: number) => {
    setChecking(true);
    setAuthorResult(null);

    try {
      const id = authorId || selectedAuthor;
      if (!id) {
        toast({
          title: 'Please select an author',
          status: 'warning',
          duration: 2000,
        });
        return;
      }

      const res = await api.post(`${API_BASE_URL}/api/credibility/author/${id}/check`);
      setAuthorResult(res.data);

      toast({
        title: 'Author check complete',
        status: 'success',
        duration: 2000,
      });
    } catch (error: any) {
      toast({
        title: 'Check failed',
        description: error.message,
        status: 'error',
        duration: 3000,
      });
    } finally {
      setChecking(false);
    }
  };

  const checkPublisherCredibility = async (publisherId?: number) => {
    setChecking(true);
    setPublisherResult(null);

    try {
      const id = publisherId || selectedPublisher;
      if (!id) {
        toast({
          title: 'Please select a publisher',
          status: 'warning',
          duration: 2000,
        });
        return;
      }

      const res = await api.post(`${API_BASE_URL}/api/credibility/publisher/${id}/check`);
      setPublisherResult(res.data);

      toast({
        title: 'Publisher check complete',
        status: 'success',
        duration: 2000,
      });
    } catch (error: any) {
      toast({
        title: 'Check failed',
        description: error.message,
        status: 'error',
        duration: 3000,
      });
    } finally {
      setChecking(false);
    }
  };

  const checkCustomAuthor = async () => {
    setChecking(true);
    setAuthorResult(null);

    try {
      const name = customName.trim();
      if (!name) {
        toast({
          title: 'Please enter a name',
          status: 'warning',
          duration: 2000,
        });
        return;
      }

      // Call custom name check endpoint
      const res = await api.post(`${API_BASE_URL}/api/credibility/check-custom-author`, {
        name: name
      });
      setAuthorResult(res.data);

      toast({
        title: 'Custom author check complete',
        status: 'success',
        duration: 2000,
      });
    } catch (error: any) {
      toast({
        title: 'Check failed',
        description: error.message,
        status: 'error',
        duration: 3000,
      });
    } finally {
      setChecking(false);
    }
  };

  const checkCustomPublisher = async () => {
    setChecking(true);
    setPublisherResult(null);

    try {
      const name = customName.trim();
      if (!name) {
        toast({
          title: 'Please enter a name',
          status: 'warning',
          duration: 2000,
        });
        return;
      }

      // Call custom name check endpoint
      const res = await api.post(`${API_BASE_URL}/api/credibility/check-custom-publisher`, {
        name: name
      });
      setPublisherResult(res.data);

      toast({
        title: 'Custom publisher check complete',
        status: 'success',
        duration: 2000,
      });
    } catch (error: any) {
      toast({
        title: 'Check failed',
        description: error.message,
        status: 'error',
        duration: 3000,
      });
    } finally {
      setChecking(false);
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'critical': return 'red';
      case 'high': return 'orange';
      case 'medium': return 'yellow';
      case 'low': return 'blue';
      case 'none': return 'green';
      default: return 'gray';
    }
  };

  const renderServiceResult = (_serviceName: string, result: any) => {
    if (result.error) {
      return (
        <Box>
          <Badge colorScheme="gray">{result.error}</Badge>
          <Text fontSize="sm" color="gray.500" mt={1}>{result.message}</Text>
        </Box>
      );
    }

    return (
      <VStack align="stretch" spacing={2}>
        {result.risk_level && (
          <HStack>
            <Text fontWeight="bold">Risk:</Text>
            <Badge colorScheme={getRiskColor(result.risk_level)}>
              {result.risk_level.toUpperCase()}
            </Badge>
          </HStack>
        )}

        {result.has_matches && (
          <HStack>
            <Text fontSize="sm">
              <Icon as={FiAlertCircle} color="orange.500" mr={2} />
              {result.match_count} match(es) found
            </Text>
            {result.matches && result.matches.length > 0 && (
              <Button
                size="xs"
                colorScheme="orange"
                onClick={() => {
                  setSelectedSanctions(result.matches);
                  onOpenSanctionsModal();
                }}
              >
                View Details
              </Button>
            )}
          </HStack>
        )}

        {result.has_cases && (
          <Text fontSize="sm">
            <Icon as={FiFileText} color="blue.500" mr={2} />
            {result.case_count} court case(s) found
          </Text>
        )}

        {result.has_complaints && (
          <Text fontSize="sm">
            <Icon as={FiAlertCircle} color="orange.500" mr={2} />
            {result.complaint_count} consumer complaint(s)
          </Text>
        )}

        {result.risk_reasons && result.risk_reasons.length > 0 && (
          <Box>
            <Text fontWeight="bold" fontSize="sm">Reasons:</Text>
            <VStack align="stretch" pl={4} spacing={1}>
              {result.risk_reasons.map((reason: string, idx: number) => (
                <Text key={idx} fontSize="sm">• {reason}</Text>
              ))}
            </VStack>
          </Box>
        )}

        {result.cases && result.cases.length > 0 && (
          <Box>
            <HStack justify="space-between" mb={2}>
              <Text fontWeight="bold" fontSize="sm">
                {result.case_count} Court Case(s) Found
              </Text>
              <Button
                size="xs"
                colorScheme="blue"
                onClick={() => {
                  setSelectedCases(result.cases);
                  onOpenCasesModal();
                }}
              >
                View All Details
              </Button>
            </HStack>
            <VStack align="stretch" pl={4} spacing={2}>
              {result.cases.slice(0, 3).map((caseData: any, idx: number) => (
                <Box key={idx} fontSize="sm">
                  <Text fontWeight="semibold">{caseData.case_name}</Text>
                  <Text color="gray.600">{caseData.court} - {caseData.date_filed}</Text>
                </Box>
              ))}
              {result.cases.length > 3 && (
                <Text fontSize="xs" color="gray.500">
                  ... and {result.cases.length - 3} more
                </Text>
              )}
            </VStack>
          </Box>
        )}

        {result.complaints && result.complaints.length > 0 && (
          <Box>
            <Text fontWeight="bold" fontSize="sm">Top Complaints:</Text>
            <VStack align="stretch" pl={4} spacing={1}>
              {result.complaints.slice(0, 3).map((complaint: any, idx: number) => (
                <Text key={idx} fontSize="sm">
                  • {complaint.issue} ({complaint.product})
                </Text>
              ))}
            </VStack>
          </Box>
        )}
      </VStack>
    );
  };

  const renderResults = (result: CredibilityResult | null) => {
    if (!result) return null;

    return (
      <Card>
        <CardBody>
          <VStack align="stretch" spacing={4}>
            {/* Overall Risk */}
            <Box>
              <HStack justify="space-between">
                <Heading size="md">Overall Assessment</Heading>
                <Badge colorScheme={getRiskColor(result.overall_risk.level)} fontSize="lg" px={3} py={1}>
                  {result.overall_risk.level.toUpperCase()}
                </Badge>
              </HStack>
              {result.overall_risk.reasons.length > 0 && (
                <VStack align="stretch" mt={2} spacing={1}>
                  {result.overall_risk.reasons.map((reason, idx) => (
                    <Text key={idx} fontSize="sm">• {reason}</Text>
                  ))}
                </VStack>
              )}
            </Box>

            <Divider />

            {/* Service Results */}
            <Accordion allowMultiple>
              {Object.entries(result.services).map(([serviceName, serviceResult]) => (
                <AccordionItem key={serviceName}>
                  <AccordionButton>
                    <Box flex="1" textAlign="left">
                      <HStack>
                        <Text fontWeight="bold">{serviceName.toUpperCase()}</Text>
                        {!serviceResult.error && serviceResult.risk_level && (
                          <Badge colorScheme={getRiskColor(serviceResult.risk_level)}>
                            {serviceResult.risk_level}
                          </Badge>
                        )}
                      </HStack>
                    </Box>
                    <AccordionIcon />
                  </AccordionButton>
                  <AccordionPanel pb={4}>
                    {renderServiceResult(serviceName, serviceResult)}
                  </AccordionPanel>
                </AccordionItem>
              ))}
            </Accordion>

            <Text fontSize="xs" color="gray.500">
              Checked at: {new Date(result.checked_at).toLocaleString()}
            </Text>
          </VStack>
        </CardBody>
      </Card>
    );
  };

  return (
    <Box>
      <Container maxW="container.xl" py={8}>
        <VStack align="stretch" spacing={6}>
          <Box>
            <Heading size="lg" mb={2}>Credibility Checker</Heading>
            <Text color="gray.600">
              Check authors and publishers against multiple credibility databases
            </Text>
          </Box>

          {/* Service Status */}
          {serviceStatus && (
            <Card>
              <CardBody>
                <Heading size="sm" mb={3}>Active Services</Heading>
                <Grid templateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={3}>
                  {Object.entries(serviceStatus).map(([key, service]: [string, any]) => (
                    <HStack key={key} spacing={2}>
                      <Icon
                        as={service.configured ? FiCheckCircle : FiAlertCircle}
                        color={service.configured ? 'green.500' : 'gray.400'}
                      />
                      <VStack align="start" spacing={0}>
                        <Text fontSize="sm" fontWeight="bold">{service.name}</Text>
                        <Text fontSize="xs" color="gray.500">{service.description}</Text>
                      </VStack>
                    </HStack>
                  ))}
                </Grid>
              </CardBody>
            </Card>
          )}

          {/* Main Content */}
          <Tabs>
            <TabList>
              <Tab>
                <Icon as={FiUser} mr={2} />
                Authors
              </Tab>
              <Tab>
                <Icon as={FiFileText} mr={2} />
                Publishers
              </Tab>
            </TabList>

            <TabPanels>
              {/* Authors Tab */}
              <TabPanel>
                <VStack align="stretch" spacing={4}>
                  <Card>
                    <CardBody>
                      <VStack align="stretch" spacing={3}>
                        <Heading size="sm">Select Author from Database</Heading>
                        <Select
                          placeholder="Choose an author..."
                          value={selectedAuthor || ''}
                          onChange={(e) => setSelectedAuthor(Number(e.target.value))}
                          isDisabled={loading}
                        >
                          {authors.map(author => (
                            <option key={author.author_id} value={author.author_id}>
                              {author.author_first_name} {author.author_last_name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          leftIcon={<FiSearch />}
                          colorScheme="blue"
                          onClick={() => checkAuthorCredibility()}
                          isLoading={checking}
                          isDisabled={!selectedAuthor}
                        >
                          Check Credibility
                        </Button>
                      </VStack>
                    </CardBody>
                  </Card>

                  <Card>
                    <CardBody>
                      <VStack align="stretch" spacing={3}>
                        <Heading size="sm">Or Search by Name</Heading>
                        <Input
                          placeholder="Enter author name (e.g., John Smith)"
                          value={customName}
                          onChange={(e) => setCustomName(e.target.value)}
                        />
                        <Button
                          leftIcon={<FiSearch />}
                          colorScheme="green"
                          onClick={() => checkCustomAuthor()}
                          isLoading={checking}
                          isDisabled={!customName.trim()}
                        >
                          Check Custom Name
                        </Button>
                      </VStack>
                    </CardBody>
                  </Card>

                  {checking && (
                    <HStack justify="center" py={8}>
                      <Spinner size="lg" />
                      <Text>Checking credibility databases...</Text>
                    </HStack>
                  )}

                  {renderResults(authorResult)}
                </VStack>
              </TabPanel>

              {/* Publishers Tab */}
              <TabPanel>
                <VStack align="stretch" spacing={4}>
                  <Card>
                    <CardBody>
                      <VStack align="stretch" spacing={3}>
                        <Heading size="sm">Select Publisher from Database</Heading>
                        <Select
                          placeholder="Choose a publisher..."
                          value={selectedPublisher || ''}
                          onChange={(e) => setSelectedPublisher(Number(e.target.value))}
                          isDisabled={loading}
                        >
                          {publishers.map(pub => (
                            <option key={pub.publisher_id} value={pub.publisher_id}>
                              {pub.publisher_name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          leftIcon={<FiSearch />}
                          colorScheme="blue"
                          onClick={() => checkPublisherCredibility()}
                          isLoading={checking}
                          isDisabled={!selectedPublisher}
                        >
                          Check Credibility
                        </Button>
                      </VStack>
                    </CardBody>
                  </Card>

                  <Card>
                    <CardBody>
                      <VStack align="stretch" spacing={3}>
                        <Heading size="sm">Or Search by Name</Heading>
                        <Input
                          placeholder="Enter publisher/organization name (e.g., New York Times)"
                          value={customName}
                          onChange={(e) => setCustomName(e.target.value)}
                        />
                        <Button
                          leftIcon={<FiSearch />}
                          colorScheme="green"
                          onClick={() => checkCustomPublisher()}
                          isLoading={checking}
                          isDisabled={!customName.trim()}
                        >
                          Check Custom Name
                        </Button>
                      </VStack>
                    </CardBody>
                  </Card>

                  {checking && (
                    <HStack justify="center" py={8}>
                      <Spinner size="lg" />
                      <Text>Checking credibility databases...</Text>
                    </HStack>
                  )}

                  {renderResults(publisherResult)}
                </VStack>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>
      </Container>

      {/* Court Cases Details Modal */}
      <Modal isOpen={isCasesModalOpen} onClose={onCloseCasesModal} size="6xl">
        <ModalOverlay />
        <ModalContent maxW="90vw">
          <ModalHeader>
            <HStack>
              <Icon as={FiFileText} />
              <Text>Court Cases Details ({selectedCases.length} total)</Text>
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <TableContainer>
              <Table variant="striped" size="sm">
                <Thead>
                  <Tr>
                    <Th width="30%">Case Name</Th>
                    <Th width="25%">Court</Th>
                    <Th width="10%">Date Filed</Th>
                    <Th width="30%">Summary</Th>
                    <Th width="5%">Link</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {selectedCases.map((caseData: any, idx: number) => (
                    <Tr
                      key={idx}
                      _hover={{ bg: 'gray.50', cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedCase(caseData);
                        onOpenCaseDetailModal();
                      }}
                    >
                      <Td fontWeight="semibold">{caseData.case_name || 'N/A'}</Td>
                      <Td>{caseData.court || 'N/A'}</Td>
                      <Td>
                        {caseData.date_filed
                          ? new Date(caseData.date_filed).toLocaleDateString()
                          : 'N/A'
                        }
                      </Td>
                      <Td fontSize="xs">
                        {caseData.snippet
                          ? caseData.snippet.substring(0, 150) + '...'
                          : 'No summary available'
                        }
                      </Td>
                      <Td>
                        {caseData.url && (
                          <Link
                            href={caseData.url}
                            isExternal
                            color="blue.500"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Icon as={FiExternalLink} />
                          </Link>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Single Case Detail Modal */}
      <Modal isOpen={isCaseDetailModalOpen} onClose={onCloseCaseDetailModal} size="4xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <HStack>
              <Icon as={FiFileText} />
              <Text>Case Details</Text>
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            {selectedCase && (
              <VStack align="stretch" spacing={4}>
                <Box>
                  <Text fontWeight="bold" fontSize="lg" mb={2}>
                    {selectedCase.case_name}
                  </Text>
                  <HStack spacing={4} fontSize="sm" color="gray.600">
                    <Text>
                      <strong>Court:</strong> {selectedCase.court}
                    </Text>
                    <Text>
                      <strong>Filed:</strong>{' '}
                      {selectedCase.date_filed
                        ? new Date(selectedCase.date_filed).toLocaleDateString()
                        : 'N/A'}
                    </Text>
                  </HStack>
                </Box>

                <Divider />

                <Box>
                  <Text fontWeight="bold" mb={2}>
                    Summary:
                  </Text>
                  <Text fontSize="sm" whiteSpace="pre-wrap">
                    {selectedCase.snippet || 'No summary available'}
                  </Text>
                </Box>

                {selectedCase.url && (
                  <Button
                    as={Link}
                    href={selectedCase.url}
                    isExternal
                    colorScheme="blue"
                    rightIcon={<Icon as={FiExternalLink} />}
                  >
                    View Full Case on CourtListener
                  </Button>
                )}
              </VStack>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* OpenSanctions Details Modal */}
      <Modal isOpen={isSanctionsModalOpen} onClose={onCloseSanctionsModal} size="6xl">
        <ModalOverlay />
        <ModalContent maxW="90vw">
          <ModalHeader>
            <HStack>
              <Icon as={FiAlertCircle} />
              <Text>OpenSanctions Matches ({selectedSanctions.length} total)</Text>
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <TableContainer>
              <Table variant="striped" size="sm">
                <Thead>
                  <Tr>
                    <Th width="25%">Name</Th>
                    <Th width="15%">Type</Th>
                    <Th width="15%">Risk Level</Th>
                    <Th width="30%">Topics</Th>
                    <Th width="15%">Datasets</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {selectedSanctions.map((match: any, idx: number) => (
                    <Tr key={idx}>
                      <Td fontWeight="semibold">{match.caption || match.id || 'N/A'}</Td>
                      <Td>
                        <Badge colorScheme="purple">{match.schema || 'Unknown'}</Badge>
                      </Td>
                      <Td>
                        <Badge
                          colorScheme={
                            match.risk_level === 'high'
                              ? 'red'
                              : match.risk_level === 'medium'
                              ? 'orange'
                              : 'blue'
                          }
                        >
                          {match.risk_level || 'N/A'}
                        </Badge>
                      </Td>
                      <Td fontSize="xs">
                        {match.topics?.join(', ') || 'No topics listed'}
                      </Td>
                      <Td fontSize="xs">
                        {match.datasets?.join(', ') || 'No datasets listed'}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  );
};

export default CredibilityPage;
