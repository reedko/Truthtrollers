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
  Card,
  CardBody,
  Grid,
  useToast,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Icon,
  useDisclosure,
} from '@chakra-ui/react';
import { FiSearch, FiUser, FiFileText, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import { api } from '../services/api';
import type { Author, Publisher } from '../../../shared/entities/types';
import CredibilityInfoModal from '../components/modals/CredibilityInfoModal';

const API_BASE_URL = import.meta.env.VITE_BASE_URL || 'https://localhost:5001';

const CredibilityPage: React.FC = () => {
  const toast = useToast();
  const { isOpen: isCredibilityModalOpen, onOpen: openCredibilityModal, onClose: closeCredibilityModal } = useDisclosure();

  const [authors, setAuthors] = useState<Author[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<any>(null);

  const [selectedAuthor, setSelectedAuthor] = useState<number | null>(null);
  const [selectedPublisher, setSelectedPublisher] = useState<number | null>(null);
  const [customName, setCustomName] = useState('');

  const [modalEntityType, setModalEntityType] = useState<'author' | 'publisher'>('author');
  const [modalEntityId, setModalEntityId] = useState<number | undefined>(undefined);
  const [modalEntityName, setModalEntityName] = useState<string>('');
  const [modalCustomName, setModalCustomName] = useState<string | undefined>(undefined);

  useEffect(() => {
    loadData();
    loadServiceStatus();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const authorsRes = await api.get(`${API_BASE_URL}/api/authors`);
      if (authorsRes.data) setAuthors(authorsRes.data);
      const publishersRes = await api.get(`${API_BASE_URL}/api/publishers`);
      if (publishersRes.data) setPublishers(publishersRes.data);
    } catch (error: any) {
      toast({ title: 'Failed to load data', description: error.message, status: 'error', duration: 3000 });
    } finally {
      setLoading(false);
    }
  };

  const loadServiceStatus = async () => {
    try {
      const res = await api.get(`${API_BASE_URL}/api/credibility/service-status`);
      if (res.data) setServiceStatus(res.data);
    } catch (error) {
      console.error('Failed to load service status:', error);
    }
  };

  const checkAuthorCredibility = () => {
    if (!selectedAuthor) {
      toast({ title: 'Please select an author', status: 'warning', duration: 2000 });
      return;
    }
    const author = authors.find(a => a.author_id === selectedAuthor);
    const name = author
      ? `${author.author_first_name} ${author.author_last_name}`.trim()
      : `Author #${selectedAuthor}`;
    setModalEntityType('author');
    setModalEntityId(selectedAuthor);
    setModalEntityName(name);
    setModalCustomName(undefined);
    openCredibilityModal();
  };

  const checkPublisherCredibility = () => {
    if (!selectedPublisher) {
      toast({ title: 'Please select a publisher', status: 'warning', duration: 2000 });
      return;
    }
    const publisher = publishers.find(p => p.publisher_id === selectedPublisher);
    const name = publisher ? publisher.publisher_name : `Publisher #${selectedPublisher}`;
    setModalEntityType('publisher');
    setModalEntityId(selectedPublisher);
    setModalEntityName(name);
    setModalCustomName(undefined);
    openCredibilityModal();
  };

  const checkCustomAuthor = () => {
    const name = customName.trim();
    if (!name) {
      toast({ title: 'Please enter a name', status: 'warning', duration: 2000 });
      return;
    }
    setModalEntityType('author');
    setModalEntityId(undefined);
    setModalEntityName(name);
    setModalCustomName(name);
    openCredibilityModal();
  };

  const checkCustomPublisher = () => {
    const name = customName.trim();
    if (!name) {
      toast({ title: 'Please enter a name', status: 'warning', duration: 2000 });
      return;
    }
    setModalEntityType('publisher');
    setModalEntityId(undefined);
    setModalEntityName(name);
    setModalCustomName(name);
    openCredibilityModal();
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

          <Tabs>
            <TabList>
              <Tab><Icon as={FiUser} mr={2} />Authors</Tab>
              <Tab><Icon as={FiFileText} mr={2} />Publishers</Tab>
            </TabList>

            <TabPanels>
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
                          onClick={checkAuthorCredibility}
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
                          onKeyDown={(e) => e.key === 'Enter' && checkCustomAuthor()}
                        />
                        <Button
                          leftIcon={<FiSearch />}
                          colorScheme="green"
                          onClick={checkCustomAuthor}
                          isDisabled={!customName.trim()}
                        >
                          Check Custom Name
                        </Button>
                      </VStack>
                    </CardBody>
                  </Card>
                </VStack>
              </TabPanel>

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
                          onClick={checkPublisherCredibility}
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
                          onKeyDown={(e) => e.key === 'Enter' && checkCustomPublisher()}
                        />
                        <Button
                          leftIcon={<FiSearch />}
                          colorScheme="green"
                          onClick={checkCustomPublisher}
                          isDisabled={!customName.trim()}
                        >
                          Check Custom Name
                        </Button>
                      </VStack>
                    </CardBody>
                  </Card>
                </VStack>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>
      </Container>

      <CredibilityInfoModal
        isOpen={isCredibilityModalOpen}
        onClose={closeCredibilityModal}
        entityType={modalEntityType}
        entityId={modalEntityId}
        entityName={modalEntityName}
        customName={modalCustomName}
      />
    </Box>
  );
};

export default CredibilityPage;
