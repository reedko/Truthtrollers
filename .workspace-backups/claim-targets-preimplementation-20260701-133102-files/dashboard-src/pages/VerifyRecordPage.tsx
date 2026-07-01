/**
 * Verify Record Page
 *
 * Displays blockchain-backed audit trail for finalized evidence chain records.
 * Shows OpenTimestamps proofs anchored to Bitcoin blockchain.
 */

import React, { useState } from 'react';
import {
  Box,
  Container,
  Heading,
  VStack,
  HStack,
  Input,
  Button,
  Text,
  Badge,
  Card,
  CardBody,
  CardHeader,
  useToast,
  Spinner,
  Divider,
  Code,
  Accordion,
  AccordionItem,
  AccordionButton,
  AccordionPanel,
  AccordionIcon,
  Link,
  Icon,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
} from '@chakra-ui/react';
import { FiSearch, FiCheckCircle, FiClock, FiAlertCircle, FiDownload, FiShield } from 'react-icons/fi';
import { api } from '../services/api';

const API_BASE_URL = import.meta.env.VITE_BASE_URL || 'https://localhost:5001';

interface AuditRecord {
  audit_id: number;
  claim_link_id: number;
  snapshot: any;
  content_hash: string;
  status: 'pending' | 'submitted' | 'verified';
  bitcoin_block: number | null;
  finalized_at: string;
  verified_at: string | null;
  finalized_by: {
    user_id: number | null;
    username: string | null;
  };
}

const VerifyRecordPage: React.FC = () => {
  const toast = useToast();

  const [claimLinkId, setClaimLinkId] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [auditRecord, setAuditRecord] = useState<AuditRecord | null>(null);

  const searchRecord = async () => {
    if (!claimLinkId) {
      toast({
        title: 'Missing claim link ID',
        description: 'Please enter a claim link ID to search',
        status: 'warning',
        duration: 3000,
      });
      return;
    }

    setLoading(true);
    try {
      const response = await api.get(
        `${API_BASE_URL}/api/audit/claim-link/${claimLinkId}`
      );

      if (response.data.success) {
        setAuditRecord(response.data.data);
      } else {
        throw new Error(response.data.error || 'Failed to fetch audit record');
      }
    } catch (error: any) {
      console.error('Error fetching audit record:', error);
      toast({
        title: 'Error',
        description:
          error.response?.data?.error || error.message || 'Failed to fetch audit record',
        status: 'error',
        duration: 5000,
      });
      setAuditRecord(null);
    } finally {
      setLoading(false);
    }
  };

  const verifyRecord = async () => {
    if (!auditRecord) return;

    setVerifying(true);
    try {
      const response = await api.get(
        `${API_BASE_URL}/api/audit/verify/${auditRecord.audit_id}`
      );

      if (response.data.success) {
        toast({
          title: response.data.data.verified ? 'Verified!' : 'Not yet confirmed',
          description: response.data.data.message,
          status: response.data.data.verified ? 'success' : 'info',
          duration: 5000,
        });

        // Refresh the audit record
        await searchRecord();
      } else {
        throw new Error(response.data.error || 'Verification failed');
      }
    } catch (error: any) {
      console.error('Error verifying timestamp:', error);
      toast({
        title: 'Verification Error',
        description: error.response?.data?.error || error.message || 'Failed to verify timestamp',
        status: 'error',
        duration: 5000,
      });
    } finally {
      setVerifying(false);
    }
  };

  const downloadProof = async () => {
    if (!auditRecord) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/audit/download-proof/${auditRecord.audit_id}`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to download proof');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claim_link_${auditRecord.audit_id}.ots`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: 'Download Started',
        description: 'OpenTimestamps proof file downloaded',
        status: 'success',
        duration: 3000,
      });
    } catch (error: any) {
      console.error('Error downloading proof:', error);
      toast({
        title: 'Download Error',
        description: error.message || 'Failed to download proof',
        status: 'error',
        duration: 5000,
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return (
          <Badge colorScheme="green" fontSize="md" px={3} py={1}>
            <HStack spacing={1}>
              <Icon as={FiCheckCircle} />
              <Text>Verified</Text>
            </HStack>
          </Badge>
        );
      case 'submitted':
        return (
          <Badge colorScheme="blue" fontSize="md" px={3} py={1}>
            <HStack spacing={1}>
              <Icon as={FiClock} />
              <Text>Pending Confirmation</Text>
            </HStack>
          </Badge>
        );
      case 'pending':
        return (
          <Badge colorScheme="orange" fontSize="md" px={3} py={1}>
            <HStack spacing={1}>
              <Icon as={FiAlertCircle} />
              <Text>Pending</Text>
            </HStack>
          </Badge>
        );
      default:
        return <Badge colorScheme="gray">{status}</Badge>;
    }
  };

  return (
    <Container maxW="container.xl" py={8}>
      <VStack spacing={8} align="stretch">
        {/* Header */}
        <Box>
          <HStack spacing={3} mb={2}>
            <Icon as={FiShield} boxSize={8} color="blue.500" />
            <Heading size="lg">Verify Record</Heading>
          </HStack>
          <Text color="gray.600">
            Verify cryptographically timestamped evidence chain records anchored to Bitcoin
            blockchain
          </Text>
        </Box>

        {/* Search Box */}
        <Card>
          <CardBody>
            <VStack spacing={4}>
              <HStack w="full">
                <Input
                  placeholder="Enter Claim Link ID"
                  value={claimLinkId}
                  onChange={(e) => setClaimLinkId(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') searchRecord();
                  }}
                  size="lg"
                  type="number"
                />
                <Button
                  leftIcon={<FiSearch />}
                  colorScheme="blue"
                  onClick={searchRecord}
                  isLoading={loading}
                  size="lg"
                  px={8}
                >
                  Search
                </Button>
              </HStack>
              <Text fontSize="sm" color="gray.500">
                Enter a claim link ID to view its blockchain audit trail
              </Text>
            </VStack>
          </CardBody>
        </Card>

        {/* Audit Record Display */}
        {auditRecord && (
          <VStack spacing={6} align="stretch">
            {/* Status Card */}
            <Card>
              <CardHeader>
                <HStack justify="space-between">
                  <Heading size="md">Audit Record #{auditRecord.audit_id}</Heading>
                  {getStatusBadge(auditRecord.status)}
                </HStack>
              </CardHeader>
              <CardBody>
                <VStack spacing={4} align="stretch">
                  <HStack justify="space-between">
                    <Text fontWeight="bold">Claim Link ID:</Text>
                    <Text>{auditRecord.claim_link_id}</Text>
                  </HStack>

                  <Divider />

                  <HStack justify="space-between">
                    <Text fontWeight="bold">Content Hash (SHA-256):</Text>
                    <Code fontSize="sm" px={2}>
                      {auditRecord.content_hash}
                    </Code>
                  </HStack>

                  <Divider />

                  <HStack justify="space-between">
                    <Text fontWeight="bold">Finalized At:</Text>
                    <Text>{new Date(auditRecord.finalized_at).toLocaleString()}</Text>
                  </HStack>

                  {auditRecord.finalized_by.username && (
                    <>
                      <Divider />
                      <HStack justify="space-between">
                        <Text fontWeight="bold">Finalized By:</Text>
                        <Text>{auditRecord.finalized_by.username}</Text>
                      </HStack>
                    </>
                  )}

                  {auditRecord.verified_at && (
                    <>
                      <Divider />
                      <HStack justify="space-between">
                        <Text fontWeight="bold">Verified At:</Text>
                        <Text>{new Date(auditRecord.verified_at).toLocaleString()}</Text>
                      </HStack>
                    </>
                  )}

                  {auditRecord.bitcoin_block && (
                    <>
                      <Divider />
                      <HStack justify="space-between">
                        <Text fontWeight="bold">Bitcoin Block:</Text>
                        <Link
                          href={`https://blockstream.info/block/${auditRecord.bitcoin_block}`}
                          isExternal
                          color="blue.500"
                        >
                          {auditRecord.bitcoin_block}
                        </Link>
                      </HStack>
                    </>
                  )}

                  <Divider />

                  <HStack spacing={3}>
                    <Button
                      leftIcon={<FiCheckCircle />}
                      colorScheme="green"
                      onClick={verifyRecord}
                      isLoading={verifying}
                      isDisabled={auditRecord.status === 'verified'}
                      flex={1}
                    >
                      {auditRecord.status === 'verified'
                        ? 'Already Verified'
                        : 'Verify Now'}
                    </Button>
                    <Button
                      leftIcon={<FiDownload />}
                      colorScheme="blue"
                      variant="outline"
                      onClick={downloadProof}
                      flex={1}
                    >
                      Download .ots Proof
                    </Button>
                  </HStack>

                  {auditRecord.status === 'submitted' && (
                    <Box bg="blue.50" p={4} borderRadius="md">
                      <Text fontSize="sm" color="blue.800">
                        This record has been submitted to OpenTimestamps and is awaiting Bitcoin
                        blockchain confirmation. This typically takes 1-6 hours. Click "Verify
                        Now" to check if the proof is ready.
                      </Text>
                    </Box>
                  )}

                  {auditRecord.status === 'verified' && (
                    <Box bg="green.50" p={4} borderRadius="md">
                      <Text fontSize="sm" color="green.800" fontWeight="bold">
                        This evidence chain record has been cryptographically timestamped and
                        verified against the Bitcoin blockchain, creating a tamper-evident audit
                        trail.
                      </Text>
                    </Box>
                  )}
                </VStack>
              </CardBody>
            </Card>

            {/* Snapshot Details */}
            <Card>
              <CardHeader>
                <Heading size="md">Canonical Snapshot</Heading>
              </CardHeader>
              <CardBody>
                <Accordion allowToggle>
                  <AccordionItem>
                    <AccordionButton>
                      <Box flex="1" textAlign="left">
                        <Text fontWeight="bold">Claim Link Details</Text>
                      </Box>
                      <AccordionIcon />
                    </AccordionButton>
                    <AccordionPanel pb={4}>
                      <TableContainer>
                        <Table size="sm" variant="simple">
                          <Tbody>
                            <Tr>
                              <Td fontWeight="bold">Source Claim ID</Td>
                              <Td>{auditRecord.snapshot.claim_link.source_claim_id}</Td>
                            </Tr>
                            <Tr>
                              <Td fontWeight="bold">Target Claim ID</Td>
                              <Td>{auditRecord.snapshot.claim_link.target_claim_id}</Td>
                            </Tr>
                            <Tr>
                              <Td fontWeight="bold">Support Level</Td>
                              <Td>{auditRecord.snapshot.claim_link.support_level}</Td>
                            </Tr>
                            <Tr>
                              <Td fontWeight="bold">Veracity Score</Td>
                              <Td>
                                {auditRecord.snapshot.claim_link.veracity_score?.toFixed(2) ||
                                  'N/A'}
                              </Td>
                            </Tr>
                            <Tr>
                              <Td fontWeight="bold">Confidence</Td>
                              <Td>
                                {auditRecord.snapshot.claim_link.confidence?.toFixed(2) || 'N/A'}
                              </Td>
                            </Tr>
                            <Tr>
                              <Td fontWeight="bold">Created By AI</Td>
                              <Td>
                                {auditRecord.snapshot.claim_link.created_by_ai ? 'Yes' : 'No'}
                              </Td>
                            </Tr>
                          </Tbody>
                        </Table>
                      </TableContainer>
                    </AccordionPanel>
                  </AccordionItem>

                  <AccordionItem>
                    <AccordionButton>
                      <Box flex="1" textAlign="left">
                        <Text fontWeight="bold">Source Claim</Text>
                      </Box>
                      <AccordionIcon />
                    </AccordionButton>
                    <AccordionPanel pb={4}>
                      <VStack align="stretch" spacing={2}>
                        <Box>
                          <Text fontWeight="bold" fontSize="sm" color="gray.600">
                            Claim Text:
                          </Text>
                          <Text mt={1}>{auditRecord.snapshot.source_claim.claim_text}</Text>
                        </Box>
                        <Divider />
                        <HStack>
                          <Text fontWeight="bold" fontSize="sm">
                            Veracity Score:
                          </Text>
                          <Text>
                            {auditRecord.snapshot.source_claim.veracity_score?.toFixed(2) || 'N/A'}
                          </Text>
                        </HStack>
                      </VStack>
                    </AccordionPanel>
                  </AccordionItem>

                  <AccordionItem>
                    <AccordionButton>
                      <Box flex="1" textAlign="left">
                        <Text fontWeight="bold">Target Claim</Text>
                      </Box>
                      <AccordionIcon />
                    </AccordionButton>
                    <AccordionPanel pb={4}>
                      <VStack align="stretch" spacing={2}>
                        <Box>
                          <Text fontWeight="bold" fontSize="sm" color="gray.600">
                            Claim Text:
                          </Text>
                          <Text mt={1}>{auditRecord.snapshot.target_claim.claim_text}</Text>
                        </Box>
                        <Divider />
                        <HStack>
                          <Text fontWeight="bold" fontSize="sm">
                            Veracity Score:
                          </Text>
                          <Text>
                            {auditRecord.snapshot.target_claim.veracity_score?.toFixed(2) || 'N/A'}
                          </Text>
                        </HStack>
                      </VStack>
                    </AccordionPanel>
                  </AccordionItem>

                  <AccordionItem>
                    <AccordionButton>
                      <Box flex="1" textAlign="left">
                        <Text fontWeight="bold">Full JSON Snapshot</Text>
                      </Box>
                      <AccordionIcon />
                    </AccordionButton>
                    <AccordionPanel pb={4}>
                      <Code
                        display="block"
                        whiteSpace="pre"
                        p={4}
                        borderRadius="md"
                        fontSize="xs"
                        overflow="auto"
                        maxH="400px"
                      >
                        {JSON.stringify(auditRecord.snapshot, null, 2)}
                      </Code>
                    </AccordionPanel>
                  </AccordionItem>
                </Accordion>
              </CardBody>
            </Card>

            {/* Information Box */}
            <Card bg="gray.50">
              <CardBody>
                <VStack spacing={3} align="stretch">
                  <Heading size="sm">About OpenTimestamps Verification</Heading>
                  <Text fontSize="sm">
                    OpenTimestamps creates a cryptographic proof that this data existed at a
                    specific point in time by anchoring it to the Bitcoin blockchain. The
                    proof can be independently verified by anyone using the .ots file.
                  </Text>
                  <Text fontSize="sm">
                    The SHA-256 hash uniquely identifies this specific snapshot. Any change to
                    the data would produce a completely different hash, making tampering
                    immediately detectable.
                  </Text>
                  <Link
                    href="https://opentimestamps.org/"
                    isExternal
                    color="blue.500"
                    fontSize="sm"
                  >
                    Learn more about OpenTimestamps →
                  </Link>
                </VStack>
              </CardBody>
            </Card>
          </VStack>
        )}

        {/* Empty State */}
        {!auditRecord && !loading && (
          <Card bg="gray.50">
            <CardBody textAlign="center" py={12}>
              <Icon as={FiSearch} boxSize={12} color="gray.400" mb={4} />
              <Text color="gray.600">
                Enter a claim link ID above to view its blockchain audit trail
              </Text>
            </CardBody>
          </Card>
        )}

        {/* Loading State */}
        {loading && (
          <Card>
            <CardBody textAlign="center" py={12}>
              <Spinner size="xl" color="blue.500" mb={4} />
              <Text color="gray.600">Searching for audit record...</Text>
            </CardBody>
          </Card>
        )}
      </VStack>
    </Container>
  );
};

export default VerifyRecordPage;
