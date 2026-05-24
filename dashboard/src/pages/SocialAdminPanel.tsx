/**
 * Social Admin Panel
 *
 * Manage X/Twitter API credentials, test connections, view auth status
 */

import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Button,
  Input,
  FormControl,
  FormLabel,
  FormHelperText,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Badge,
  Divider,
  useColorModeValue,
  Card,
  CardHeader,
  CardBody,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Code,
  Textarea,
  useToast,
  Spinner,
  InputGroup,
  InputRightElement,
  IconButton,
} from '@chakra-ui/react';
import { FiTwitter, FiRefreshCw, FiCheck, FiX, FiSettings, FiEye, FiEyeOff } from 'react-icons/fi';

interface XCredentials {
  client_id?: string;
  client_secret?: string;
  has_credentials: boolean;
}

interface XAuthStatus {
  connected: boolean;
  x_username?: string;
  x_user_id?: string;
  needs_refresh?: boolean;
  token_expires_at?: string;
}

interface ConnectionTestResult {
  success: boolean;
  message: string;
  details?: any;
}

const SocialAdminPanel: React.FC = () => {
  const [credentials, setCredentials] = useState<XCredentials>({ has_credentials: false });
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [authStatus, setAuthStatus] = useState<XAuthStatus | null>(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.600');

  // Check for OAuth success redirect
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('connected') === 'true') {
      const username = params.get('username');
      toast({
        title: 'X Account Connected!',
        description: username ? `Successfully connected @${username}` : 'Your X account has been connected',
        status: 'success',
        duration: 5000,
        isClosable: true,
      });
      // Clean up URL
      navigate('/admin/social', { replace: true });
      // Reload auth status
      loadAuthStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    loadCredentialsStatus();
    loadCredentials();
    loadAuthStatus();
  }, []);

  const loadCredentialsStatus = async () => {
    try {
      const response = await fetch('/api/admin/x-credentials/status', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });
      const data = await response.json();
      setCredentials(data);
    } catch (error) {
      console.error('Failed to load credentials status:', error);
    }
  };

  const loadCredentials = async () => {
    try {
      const response = await fetch('/api/admin/x-credentials', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });
      const data = await response.json();

      // Populate form fields with stored credentials (if they exist)
      if (data.credentials && data.credentials.client_id) {
        setClientId(data.credentials.client_id);
      }
      // Note: client_secret is never returned from backend for security
    } catch (error) {
      console.error('Failed to load credentials:', error);
    }
  };

  const loadAuthStatus = async () => {
    try {
      const response = await fetch('/api/x-auth/status', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });
      const data = await response.json();
      setAuthStatus(data);
    } catch (error) {
      console.error('Failed to load auth status:', error);
    }
  };

  const handleSaveCredentials = async () => {
    if (!clientId || !clientSecret) {
      toast({
        title: 'Missing credentials',
        description: 'Please provide both Client ID and Client Secret',
        status: 'warning',
        duration: 3000,
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/admin/x-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (response.ok) {
        toast({
          title: 'Credentials saved',
          description: 'X API credentials updated successfully',
          status: 'success',
          duration: 3000,
        });
        // Only clear the secret (security), keep client_id visible
        setClientSecret('');
        loadCredentialsStatus();
        loadCredentials();
      } else {
        const error = await response.json();
        throw new Error(error.message || 'Failed to save credentials');
      }
    } catch (error: any) {
      toast({
        title: 'Error saving credentials',
        description: error.message,
        status: 'error',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/admin/x-credentials/test', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      const data = await response.json();
      setTestResult(data);

      if (data.success) {
        toast({
          title: 'Connection successful',
          description: 'X API credentials are valid',
          status: 'success',
          duration: 3000,
        });
      } else {
        toast({
          title: 'Connection failed',
          description: data.message,
          status: 'error',
          duration: 5000,
        });
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.message || 'Network error',
      });
      toast({
        title: 'Test failed',
        description: error.message,
        status: 'error',
        duration: 5000,
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleConnectAccount = async () => {
    try {
      // Make authenticated request to get OAuth URL
      const response = await fetch('/api/x-auth/connect', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      if (response.ok) {
        // Backend returns OAuth URL, redirect to X
        const data = await response.json();
        if (data.auth_url) {
          window.location.href = data.auth_url;
        }
      } else {
        const error = await response.json();
        toast({
          title: 'Connection failed',
          description: error.error || 'Failed to initiate OAuth flow',
          status: 'error',
          duration: 5000,
        });
      }
    } catch (error: any) {
      toast({
        title: 'Connection error',
        description: error.message,
        status: 'error',
        duration: 5000,
      });
    }
  };

  const handleDisconnectAccount = async () => {
    if (!confirm('Are you sure you want to disconnect your X account?')) {
      return;
    }

    try {
      const response = await fetch('/api/x-auth/disconnect', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('jwt')}`,
        },
      });

      if (response.ok) {
        toast({
          title: 'Account disconnected',
          description: 'Your X account has been disconnected',
          status: 'success',
          duration: 3000,
        });
        loadAuthStatus();
      }
    } catch (error: any) {
      toast({
        title: 'Error disconnecting',
        description: error.message,
        status: 'error',
        duration: 5000,
      });
    }
  };

  return (
    <Container maxW="container.xl" py={8}>
      <VStack spacing={8} align="stretch">
        {/* Header */}
        <Box>
          <HStack spacing={4} mb={2}>
            <FiSettings size={40} />
            <Heading size="xl">Social Admin Panel</Heading>
          </HStack>
          <Text color="gray.600" fontSize="lg">
            Configure X/Twitter credentials, test connections, and manage authentication
          </Text>
        </Box>

        {/* Credentials Status Overview */}
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
          <Card>
            <CardBody>
              <Stat>
                <StatLabel>API Credentials</StatLabel>
                <StatNumber>
                  {credentials.has_credentials ? (
                    <Badge colorScheme="green" fontSize="md">Configured</Badge>
                  ) : (
                    <Badge colorScheme="red" fontSize="md">Not Set</Badge>
                  )}
                </StatNumber>
                <StatHelpText>X API Client ID & Secret</StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Stat>
                <StatLabel>Account Connection</StatLabel>
                <StatNumber>
                  {authStatus?.connected ? (
                    <Badge colorScheme="green" fontSize="md">Connected</Badge>
                  ) : (
                    <Badge colorScheme="yellow" fontSize="md">Not Connected</Badge>
                  )}
                </StatNumber>
                <StatHelpText>
                  {authStatus?.connected ? `@${authStatus.x_username}` : 'No account linked'}
                </StatHelpText>
              </Stat>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Stat>
                <StatLabel>Connection Test</StatLabel>
                <StatNumber>
                  {testResult ? (
                    testResult.success ? (
                      <Badge colorScheme="green" fontSize="md">Passed</Badge>
                    ) : (
                      <Badge colorScheme="red" fontSize="md">Failed</Badge>
                    )
                  ) : (
                    <Badge colorScheme="gray" fontSize="md">Not Tested</Badge>
                  )}
                </StatNumber>
                <StatHelpText>API connectivity status</StatHelpText>
              </Stat>
            </CardBody>
          </Card>
        </SimpleGrid>

        {/* X API Credentials */}
        <Card>
          <CardHeader>
            <Heading size="md">X API Credentials</Heading>
          </CardHeader>
          <CardBody>
            <VStack spacing={4} align="stretch">
              <Alert status="info" borderRadius="md">
                <AlertIcon />
                <Box>
                  <AlertTitle>How to get X API credentials</AlertTitle>
                  <AlertDescription>
                    1. Go to{' '}
                    <Code as="a" href="https://developer.twitter.com/en/portal/dashboard" target="_blank">
                      developer.twitter.com
                    </Code>
                    <br />
                    2. Create an app (or use existing)
                    <br />
                    3. Copy Client ID and Client Secret from OAuth 2.0 settings
                    <br />
                    4. Add redirect URL: <Code>http://localhost:3000/api/x-auth/callback</Code>
                  </AlertDescription>
                </Box>
              </Alert>

              <FormControl>
                <FormLabel>Client ID</FormLabel>
                <Input
                  placeholder="Enter X API Client ID"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  type="text"
                />
                <FormHelperText>
                  Found in X Developer Portal → Your App → Keys and tokens
                </FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel>Client Secret</FormLabel>
                <InputGroup>
                  <Input
                    placeholder="Enter X API Client Secret"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    type={showSecret ? 'text' : 'password'}
                  />
                  <InputRightElement>
                    <IconButton
                      aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                      icon={showSecret ? <FiEyeOff /> : <FiEye />}
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowSecret(!showSecret)}
                    />
                  </InputRightElement>
                </InputGroup>
                <FormHelperText>
                  Keep this secret! Never share publicly
                </FormHelperText>
              </FormControl>

              <HStack>
                <Button
                  colorScheme="blue"
                  onClick={handleSaveCredentials}
                  isLoading={loading}
                  loadingText="Saving..."
                >
                  Save Credentials
                </Button>
                {credentials.has_credentials && (
                  <Badge colorScheme="green">
                    <FiCheck style={{ display: 'inline', marginRight: 4 }} />
                    Credentials stored
                  </Badge>
                )}
              </HStack>
            </VStack>
          </CardBody>
        </Card>

        {/* Connection Test */}
        <Card>
          <CardHeader>
            <Heading size="md">Test X API Connection</Heading>
          </CardHeader>
          <CardBody>
            <VStack spacing={4} align="stretch">
              <Text>
                Test if your X API credentials are valid and the connection is working.
                This will attempt to fetch data from X API.
              </Text>

              <Button
                leftIcon={<FiRefreshCw />}
                colorScheme="purple"
                onClick={handleTestConnection}
                isLoading={testingConnection}
                loadingText="Testing..."
                isDisabled={!credentials.has_credentials}
              >
                Test Connection
              </Button>

              {testResult && (
                <Alert
                  status={testResult.success ? 'success' : 'error'}
                  borderRadius="md"
                >
                  <AlertIcon as={testResult.success ? FiCheck : FiX} />
                  <Box flex={1}>
                    <AlertTitle>
                      {testResult.success ? 'Connection Successful' : 'Connection Failed'}
                    </AlertTitle>
                    <AlertDescription>
                      {testResult.message}
                      {testResult.details && (
                        <Textarea
                          mt={2}
                          value={JSON.stringify(testResult.details, null, 2)}
                          readOnly
                          fontSize="xs"
                          fontFamily="mono"
                          rows={6}
                        />
                      )}
                    </AlertDescription>
                  </Box>
                </Alert>
              )}

              {/* Big Connect Button - Prominent! */}
              {testResult?.success && !authStatus?.connected && (
                <Box
                  p={6}
                  bg={useColorModeValue('blue.50', 'blue.900')}
                  borderRadius="lg"
                  borderWidth={2}
                  borderColor="blue.500"
                >
                  <VStack spacing={4}>
                    <Text fontSize="lg" fontWeight="bold" textAlign="center">
                      ✅ Credentials Valid! Next Step:
                    </Text>
                    <Button
                      leftIcon={<FiTwitter />}
                      colorScheme="twitter"
                      size="xl"
                      fontSize="xl"
                      p={8}
                      w="full"
                      onClick={handleConnectAccount}
                      _hover={{ transform: 'scale(1.05)' }}
                      transition="all 0.2s"
                    >
                      🚀 Connect Your X Account Now
                    </Button>
                    <Text fontSize="sm" color="gray.600" textAlign="center">
                      You'll be redirected to X to authorize TruthTrollers
                    </Text>
                  </VStack>
                </Box>
              )}
            </VStack>
          </CardBody>
        </Card>

        {/* Account Connection */}
        <Card>
          <CardHeader>
            <Heading size="md">User Account Connection</Heading>
          </CardHeader>
          <CardBody>
            <VStack spacing={4} align="stretch">
              {authStatus ? (
                authStatus.connected ? (
                  <>
                    <Alert status="success" borderRadius="md">
                      <AlertIcon />
                      <Box flex={1}>
                        <AlertTitle>Connected to X</AlertTitle>
                        <AlertDescription>
                          <Text>Username: <strong>@{authStatus.x_username}</strong></Text>
                          <Text>User ID: <Code>{authStatus.x_user_id}</Code></Text>
                          {authStatus.token_expires_at && (
                            <Text fontSize="sm" color="gray.600">
                              Token expires: {new Date(authStatus.token_expires_at).toLocaleString()}
                            </Text>
                          )}
                        </AlertDescription>
                      </Box>
                    </Alert>

                    {authStatus.needs_refresh && (
                      <Alert status="warning" borderRadius="md">
                        <AlertIcon />
                        <Text>Token needs refresh. Reconnect to refresh access.</Text>
                      </Alert>
                    )}

                    <HStack>
                      <Button
                        leftIcon={<FiTwitter />}
                        colorScheme="twitter"
                        onClick={handleConnectAccount}
                      >
                        Reconnect X Account
                      </Button>
                      <Button
                        variant="outline"
                        colorScheme="red"
                        onClick={handleDisconnectAccount}
                      >
                        Disconnect
                      </Button>
                    </HStack>
                  </>
                ) : (
                  <>
                    <Alert status="warning" borderRadius="md">
                      <AlertIcon />
                      <Text>Not connected to X. Connect to enable live feed features.</Text>
                    </Alert>

                    <Button
                      leftIcon={<FiTwitter />}
                      colorScheme="twitter"
                      onClick={handleConnectAccount}
                      isDisabled={!credentials.has_credentials}
                      size="lg"
                    >
                      Connect X Account
                    </Button>

                    {!credentials.has_credentials && (
                      <Text fontSize="sm" color="red.500">
                        ⚠ Configure API credentials first before connecting
                      </Text>
                    )}
                  </>
                )
              ) : (
                <HStack>
                  <Spinner size="sm" />
                  <Text>Loading auth status...</Text>
                </HStack>
              )}
            </VStack>
          </CardBody>
        </Card>

        <Divider />

        {/* Troubleshooting */}
        <Card>
          <CardHeader>
            <Heading size="md">Troubleshooting</Heading>
          </CardHeader>
          <CardBody>
            <VStack align="start" spacing={3}>
              <Text fontWeight="bold">Common Issues:</Text>

              <Box>
                <Text fontWeight="semibold">❌ "Connection failed" error</Text>
                <Text fontSize="sm" color="gray.600" ml={4}>
                  - Check Client ID and Client Secret are correct
                  <br />
                  - Verify app has OAuth 2.0 enabled in X Developer Portal
                  <br />
                  - Ensure redirect URL is configured correctly
                </Text>
              </Box>

              <Box>
                <Text fontWeight="semibold">❌ "Authorization failed" during OAuth</Text>
                <Text fontSize="sm" color="gray.600" ml={4}>
                  - Make sure your X app has "Read" permissions at minimum
                  <br />
                  - Try regenerating credentials in X Developer Portal
                  <br />
                  - Check that callback URL matches exactly
                </Text>
              </Box>

              <Box>
                <Text fontWeight="semibold">❌ "Token expired" errors</Text>
                <Text fontSize="sm" color="gray.600" ml={4}>
                  - Click "Reconnect X Account" to refresh tokens
                  <br />
                  - X OAuth tokens expire after a period of inactivity
                </Text>
              </Box>

              <Box>
                <Text fontWeight="semibold">📚 Documentation</Text>
                <Text fontSize="sm" color="gray.600" ml={4}>
                  <Code as="a" href="https://developer.twitter.com/en/docs/authentication/oauth-2-0" target="_blank">
                    X OAuth 2.0 Documentation
                  </Code>
                </Text>
              </Box>
            </VStack>
          </CardBody>
        </Card>
      </VStack>
    </Container>
  );
};

export default SocialAdminPanel;
