import React, { useState, useEffect } from "react";
import {
  Box,
  Container,
  Heading,
  Grid,
  VStack,
  HStack,
  Text,
  Badge,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Spinner,
  useToast,
  Card,
  CardHeader,
  CardBody,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Center,
  Icon,
  Flex,
  Select,
} from "@chakra-ui/react";
import { FiUsers, FiActivity, FiBarChart2, FiClock } from "react-icons/fi";
import { api } from "../services/api";
import { useAuthStore } from "../store/useAuthStore";
import { useNavigate } from "react-router-dom";

interface OnlineUser {
  user_id: number;
  username: string;
  email: string;
  role: string;
  user_since: string;
  last_active: string;
  minutes_ago: number;
}

interface Activity {
  activity_id: number;
  user_id: number | null;
  username: string | null;
  activity_type: string;
  content_id: number | null;
  claim_id: number | null;
  link_id: number | null;
  metadata: any;
  created_at: string;
  user_username: string | null;
  content_title: string | null;
}

interface Stats {
  totalUsers: number;
  totalContent: number;
  totalClaims: number;
  activitiesLast24h: number;
  activitiesLast7d: number;
  topContributors: Array<{
    user_id: number;
    username: string;
    activity_count: number;
  }>;
}

interface LoginAttempt {
  id: number;
  username: string;
  success: boolean;
  ip_address: string;
  user_agent: string;
  reason: string | null;
  fingerprint: string | null;
  user_id: number | null;
  created_at: string;
  resolved_username: string | null;
}

interface RegistrationAttempt {
  id: number;
  username: string;
  email: string;
  success: boolean;
  ip_address: string;
  message: string | null;
  user_agent: string;
  created_at: string;
}

interface LoginEvent {
  id: number;
  user_id: number | null;
  username: string | null;
  fingerprint: string;
  event_type: string;
  ip_address: string;
  details: string | null;
  created_at: string;
}

export default function AdminPanelPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const toast = useToast();

  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loginAttempts, setLoginAttempts] = useState<LoginAttempt[]>([]);
  const [registrationAttempts, setRegistrationAttempts] = useState<RegistrationAttempt[]>([]);
  const [loginEvents, setLoginEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityFilter, setActivityFilter] = useState<string>("all");
  const [loginFilter, setLoginFilter] = useState<string>("all");
  const [registrationFilter, setRegistrationFilter] = useState<string>("all");
  const [loginEventFilter, setLoginEventFilter] = useState<string>("all");

  // Redirect if not super admin
  useEffect(() => {
    if (user?.role !== "super_admin") {
      toast({
        title: "Access Denied",
        description: "This page is only accessible to super administrators",
        status: "error",
        duration: 3000,
      });
      navigate("/");
    }
  }, [user, navigate, toast]);

  useEffect(() => {
    loadAllData();
    // Refresh every 30 seconds
    const interval = setInterval(loadAllData, 30000);
    return () => clearInterval(interval);
  }, [activityFilter, loginFilter, registrationFilter, loginEventFilter]);

  const loadAllData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadOnlineUsers(),
        loadActivities(),
        loadStats(),
        loadLoginAttempts(),
        loadRegistrationAttempts(),
        loadLoginEvents(),
      ]);
    } catch (error) {
      console.error("Failed to load admin data:", error);
      toast({
        title: "Error loading data",
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadOnlineUsers = async () => {
    try {
      const response = await api.get("/api/admin/online-users");
      setOnlineUsers(response.data.onlineUsers || []);
    } catch (error) {
      console.error("Failed to load online users:", error);
    }
  };

  const loadActivities = async () => {
    try {
      const params: any = { limit: 100 };
      if (activityFilter !== "all") {
        params.activityType = activityFilter;
      }
      const response = await api.get("/api/admin/recent-activities", { params });
      setActivities(response.data.activities || []);
    } catch (error) {
      console.error("Failed to load activities:", error);
    }
  };

  const loadStats = async () => {
    try {
      const response = await api.get("/api/admin/stats");
      setStats(response.data.stats);
    } catch (error) {
      console.error("Failed to load stats:", error);
    }
  };

  const loadLoginAttempts = async () => {
    try {
      const params: any = { limit: 50 };
      if (loginFilter !== "all") {
        params.success = loginFilter;
      }
      const response = await api.get("/api/admin/login-attempts", { params });
      setLoginAttempts(response.data.attempts || []);
    } catch (error) {
      console.error("Failed to load login attempts:", error);
    }
  };

  const loadRegistrationAttempts = async () => {
    try {
      const params: any = { limit: 50 };
      if (registrationFilter !== "all") {
        params.success = registrationFilter;
      }
      const response = await api.get("/api/admin/registration-attempts", { params });
      setRegistrationAttempts(response.data.attempts || []);
    } catch (error) {
      console.error("Failed to load registration attempts:", error);
    }
  };

  const loadLoginEvents = async () => {
    try {
      const params: any = { limit: 50 };
      if (loginEventFilter !== "all") {
        params.eventType = loginEventFilter;
      }
      const response = await api.get("/api/admin/login-events", { params });
      setLoginEvents(response.data.events || []);
    } catch (error) {
      console.error("Failed to load login events:", error);
    }
  };

  const getActivityBadgeColor = (type: string) => {
    const colors: Record<string, string> = {
      evidence_run: "purple",
      claim_link_add: "green",
      claim_link_evaluate: "blue",
      task_view: "gray",
      discussion_post: "orange",
    };
    return colors[type] || "gray";
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (user?.role !== "super_admin") {
    return null;
  }

  return (
    <Container maxW="container.xl" py={8}>
      <VStack spacing={8} align="stretch">
        {/* Header */}
        <HStack justify="space-between">
          <Heading size="xl" color="cyan.400">
            Admin Panel
          </Heading>
          <Badge colorScheme="purple" fontSize="md" px={3} py={1}>
            Super Admin
          </Badge>
        </HStack>

        {/* Stats Overview */}
        {loading && !stats ? (
          <Center py={10}>
            <Spinner size="xl" color="cyan.400" />
          </Center>
        ) : stats ? (
          <Grid
            templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }}
            gap={6}
          >
            <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
              <CardBody>
                <Stat>
                  <Flex align="center" mb={2}>
                    <Icon as={FiUsers} boxSize={5} color="cyan.400" mr={2} />
                    <StatLabel>Total Users</StatLabel>
                  </Flex>
                  <StatNumber color="cyan.400">{stats.totalUsers}</StatNumber>
                  <StatHelpText>{onlineUsers.length} online now</StatHelpText>
                </Stat>
              </CardBody>
            </Card>

            <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
              <CardBody>
                <Stat>
                  <Flex align="center" mb={2}>
                    <Icon as={FiBarChart2} boxSize={5} color="cyan.400" mr={2} />
                    <StatLabel>Total Content</StatLabel>
                  </Flex>
                  <StatNumber color="cyan.400">{stats.totalContent}</StatNumber>
                  <StatHelpText>{stats.totalClaims} claims</StatHelpText>
                </Stat>
              </CardBody>
            </Card>

            <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
              <CardBody>
                <Stat>
                  <Flex align="center" mb={2}>
                    <Icon as={FiActivity} boxSize={5} color="cyan.400" mr={2} />
                    <StatLabel>Activities (24h)</StatLabel>
                  </Flex>
                  <StatNumber color="cyan.400">{stats.activitiesLast24h}</StatNumber>
                  <StatHelpText>Last 24 hours</StatHelpText>
                </Stat>
              </CardBody>
            </Card>

            <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
              <CardBody>
                <Stat>
                  <Flex align="center" mb={2}>
                    <Icon as={FiActivity} boxSize={5} color="cyan.400" mr={2} />
                    <StatLabel>Activities (7d)</StatLabel>
                  </Flex>
                  <StatNumber color="cyan.400">{stats.activitiesLast7d}</StatNumber>
                  <StatHelpText>Last 7 days</StatHelpText>
                </Stat>
              </CardBody>
            </Card>
          </Grid>
        ) : null}

        {/* Tabs for different views */}
        <Tabs variant="soft-rounded" colorScheme="cyan">
          <TabList>
            <Tab>Online Users</Tab>
            <Tab>Recent Activity</Tab>
            <Tab>Login Attempts</Tab>
            <Tab>Login Events</Tab>
            <Tab>Registrations</Tab>
            <Tab>Top Contributors</Tab>
          </TabList>

          <TabPanels>
            {/* Online Users Tab */}
            <TabPanel>
              <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
                <CardHeader>
                  <HStack justify="space-between">
                    <Heading size="md">
                      Online Users ({onlineUsers.length})
                    </Heading>
                    <HStack>
                      <Icon as={FiClock} color="cyan.400" />
                      <Text fontSize="sm" color="gray.400">
                        Active in last 15 minutes
                      </Text>
                    </HStack>
                  </HStack>
                </CardHeader>
                <CardBody>
                  {loading ? (
                    <Center py={10}>
                      <Spinner color="cyan.400" />
                    </Center>
                  ) : onlineUsers.length === 0 ? (
                    <Center py={10}>
                      <Text color="gray.500">No users currently online</Text>
                    </Center>
                  ) : (
                    <Box overflowX="auto" overflowY="auto" maxH="600px">
                      <Table variant="simple" size="sm">
                        <Thead>
                          <Tr>
                            <Th>Username</Th>
                            <Th>Email</Th>
                            <Th>Role</Th>
                            <Th>Last Active</Th>
                            <Th>Member Since</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {onlineUsers.map((user) => (
                            <Tr key={user.user_id}>
                              <Td>
                                <HStack>
                                  <Box
                                    w={2}
                                    h={2}
                                    borderRadius="full"
                                    bg="green.400"
                                  />
                                  <Text fontWeight="bold">{user.username}</Text>
                                </HStack>
                              </Td>
                              <Td>{user.email}</Td>
                              <Td>
                                <Badge colorScheme={user.role === "super_admin" ? "purple" : "blue"}>
                                  {user.role}
                                </Badge>
                              </Td>
                              <Td>{formatTimeAgo(user.last_active)}</Td>
                              <Td>
                                {new Date(user.user_since).toLocaleDateString()}
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  )}
                </CardBody>
              </Card>
            </TabPanel>

            {/* Recent Activity Tab */}
            <TabPanel>
              <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
                <CardHeader>
                  <HStack justify="space-between">
                    <Heading size="md">
                      Recent Activity ({activities.length})
                    </Heading>
                    <Select
                      value={activityFilter}
                      onChange={(e) => setActivityFilter(e.target.value)}
                      w="200px"
                      size="sm"
                    >
                      <option value="all">All Activities</option>
                      <option value="evidence_run">Evidence Runs</option>
                      <option value="claim_link_add">Claim Links Added</option>
                      <option value="claim_link_evaluate">Link Evaluations</option>
                      <option value="task_view">Case Views</option>
                      <option value="discussion_post">Discussion Posts</option>
                    </Select>
                  </HStack>
                </CardHeader>
                <CardBody>
                  {loading ? (
                    <Center py={10}>
                      <Spinner color="cyan.400" />
                    </Center>
                  ) : activities.length === 0 ? (
                    <Center py={10}>
                      <Text color="gray.500">No recent activities</Text>
                    </Center>
                  ) : (
                    <Box overflowX="auto" overflowY="auto" maxH="600px">
                      <Table variant="simple" size="sm">
                        <Thead>
                          <Tr>
                            <Th>User</Th>
                            <Th>Activity</Th>
                            <Th>Content</Th>
                            <Th>Time</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {activities.map((activity) => (
                            <Tr key={activity.activity_id}>
                              <Td>
                                {activity.user_username || activity.username || "Guest"}
                              </Td>
                              <Td>
                                <Badge colorScheme={getActivityBadgeColor(activity.activity_type)}>
                                  {activity.activity_type.replace(/_/g, " ")}
                                </Badge>
                              </Td>
                              <Td>
                                {activity.content_title || `Content #${activity.content_id}`}
                              </Td>
                              <Td>{formatTimeAgo(activity.created_at)}</Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  )}
                </CardBody>
              </Card>
            </TabPanel>

            {/* Login Attempts Tab */}
            <TabPanel>
              <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
                <CardHeader>
                  <HStack justify="space-between">
                    <Heading size="md">
                      Login Attempts ({loginAttempts.length})
                    </Heading>
                    <Select
                      value={loginFilter}
                      onChange={(e) => setLoginFilter(e.target.value)}
                      w="200px"
                      size="sm"
                    >
                      <option value="all">All Attempts</option>
                      <option value="true">Successful</option>
                      <option value="false">Failed</option>
                    </Select>
                  </HStack>
                </CardHeader>
                <CardBody>
                  {loading ? (
                    <Center py={10}>
                      <Spinner color="cyan.400" />
                    </Center>
                  ) : loginAttempts.length === 0 ? (
                    <Center py={10}>
                      <Text color="gray.500">No login attempts found</Text>
                    </Center>
                  ) : (
                    <Box overflowX="auto" overflowY="auto" maxH="600px">
                      <Table variant="simple" size="sm">
                        <Thead>
                          <Tr>
                            <Th>Status</Th>
                            <Th>Username</Th>
                            <Th>IP Address</Th>
                            <Th>Reason</Th>
                            <Th>Time</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {loginAttempts.map((attempt) => (
                            <Tr key={attempt.id}>
                              <Td>
                                <Badge colorScheme={attempt.success ? "green" : "red"}>
                                  {attempt.success ? "Success" : "Failed"}
                                </Badge>
                              </Td>
                              <Td fontWeight={attempt.success ? "bold" : "normal"}>
                                {attempt.resolved_username || attempt.username}
                              </Td>
                              <Td fontFamily="monospace" fontSize="xs">
                                {attempt.ip_address}
                              </Td>
                              <Td>
                                {attempt.reason ? (
                                  <Badge colorScheme="orange" fontSize="xs">
                                    {attempt.reason.replace(/_/g, " ")}
                                  </Badge>
                                ) : (
                                  <Text color="gray.500">-</Text>
                                )}
                              </Td>
                              <Td>{formatTimeAgo(attempt.created_at)}</Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  )}
                </CardBody>
              </Card>
            </TabPanel>

            {/* Login Events Tab */}
            <TabPanel>
              <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
                <CardHeader>
                  <HStack justify="space-between">
                    <Heading size="md">
                      Login Events ({loginEvents.length})
                    </Heading>
                    <Select
                      value={loginEventFilter}
                      onChange={(e) => setLoginEventFilter(e.target.value)}
                      w="200px"
                      size="sm"
                    >
                      <option value="all">All Events</option>
                      <option value="login">Logins</option>
                      <option value="logout">Logouts</option>
                      <option value="password_reset_request">Password Resets</option>
                      <option value="password_changed">Password Changed</option>
                    </Select>
                  </HStack>
                </CardHeader>
                <CardBody>
                  {loading ? (
                    <Center py={10}>
                      <Spinner color="cyan.400" />
                    </Center>
                  ) : loginEvents.length === 0 ? (
                    <Center py={10}>
                      <Text color="gray.500">No login events found</Text>
                    </Center>
                  ) : (
                    <Box overflowX="auto" overflowY="auto" maxH="600px">
                      <Table variant="simple" size="sm">
                        <Thead>
                          <Tr>
                            <Th>Event Type</Th>
                            <Th>Username</Th>
                            <Th>IP Address</Th>
                            <Th>Details</Th>
                            <Th>Time</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {loginEvents.map((event) => (
                            <Tr key={event.id}>
                              <Td>
                                <Badge
                                  colorScheme={
                                    event.event_type === 'login' ? 'green' :
                                    event.event_type === 'logout' ? 'gray' :
                                    event.event_type === 'password_reset_request' ? 'orange' :
                                    'blue'
                                  }
                                >
                                  {event.event_type.replace(/_/g, ' ')}
                                </Badge>
                              </Td>
                              <Td fontWeight="bold">
                                {event.username || `User #${event.user_id}`}
                              </Td>
                              <Td fontFamily="monospace" fontSize="xs">
                                {event.ip_address}
                              </Td>
                              <Td fontSize="xs" color="gray.400">
                                {event.details ?
                                  (() => {
                                    try {
                                      const details = JSON.parse(event.details);
                                      return details.username || details.email || '-';
                                    } catch {
                                      return '-';
                                    }
                                  })()
                                  : '-'
                                }
                              </Td>
                              <Td>{formatTimeAgo(event.created_at)}</Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  )}
                </CardBody>
              </Card>
            </TabPanel>

            {/* Registration Attempts Tab */}
            <TabPanel>
              <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
                <CardHeader>
                  <HStack justify="space-between">
                    <Heading size="md">
                      Registration Attempts ({registrationAttempts.length})
                    </Heading>
                    <Select
                      value={registrationFilter}
                      onChange={(e) => setRegistrationFilter(e.target.value)}
                      w="200px"
                      size="sm"
                    >
                      <option value="all">All Attempts</option>
                      <option value="true">Successful</option>
                      <option value="false">Failed</option>
                    </Select>
                  </HStack>
                </CardHeader>
                <CardBody>
                  {loading ? (
                    <Center py={10}>
                      <Spinner color="cyan.400" />
                    </Center>
                  ) : registrationAttempts.length === 0 ? (
                    <Center py={10}>
                      <Text color="gray.500">No registration attempts found</Text>
                    </Center>
                  ) : (
                    <Box overflowX="auto" overflowY="auto" maxH="600px">
                      <Table variant="simple" size="sm">
                        <Thead>
                          <Tr>
                            <Th>Status</Th>
                            <Th>Username</Th>
                            <Th>Email</Th>
                            <Th>IP Address</Th>
                            <Th>Message</Th>
                            <Th>Time</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {registrationAttempts.map((attempt) => (
                            <Tr key={attempt.id}>
                              <Td>
                                <Badge colorScheme={attempt.success ? "green" : "red"}>
                                  {attempt.success ? "Success" : "Failed"}
                                </Badge>
                              </Td>
                              <Td fontWeight={attempt.success ? "bold" : "normal"}>
                                {attempt.username}
                              </Td>
                              <Td fontSize="sm">{attempt.email}</Td>
                              <Td fontFamily="monospace" fontSize="xs">
                                {attempt.ip_address}
                              </Td>
                              <Td fontSize="xs" color="gray.400">
                                {attempt.message || "-"}
                              </Td>
                              <Td>{formatTimeAgo(attempt.created_at)}</Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  )}
                </CardBody>
              </Card>
            </TabPanel>

            {/* Top Contributors Tab */}
            <TabPanel>
              <Card bg="rgba(0, 229, 255, 0.05)" borderColor="cyan.400" borderWidth="1px">
                <CardHeader>
                  <Heading size="md">
                    Top Contributors (Last 7 Days)
                  </Heading>
                </CardHeader>
                <CardBody>
                  {loading || !stats ? (
                    <Center py={10}>
                      <Spinner color="cyan.400" />
                    </Center>
                  ) : stats.topContributors.length === 0 ? (
                    <Center py={10}>
                      <Text color="gray.500">No activity in the last 7 days</Text>
                    </Center>
                  ) : (
                    <Box overflowX="auto" overflowY="auto" maxH="600px">
                      <Table variant="simple" size="sm">
                        <Thead>
                          <Tr>
                            <Th>Rank</Th>
                            <Th>Username</Th>
                            <Th>Activities</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {stats.topContributors.map((contributor, index) => (
                            <Tr key={contributor.user_id}>
                              <Td>
                                <Badge
                                  colorScheme={
                                    index === 0 ? "yellow" : index === 1 ? "gray" : index === 2 ? "orange" : "cyan"
                                  }
                                  fontSize="lg"
                                >
                                  #{index + 1}
                                </Badge>
                              </Td>
                              <Td fontWeight="bold">{contributor.username}</Td>
                              <Td>
                                <Badge colorScheme="cyan" fontSize="md">
                                  {contributor.activity_count}
                                </Badge>
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </Box>
                  )}
                </CardBody>
              </Card>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </VStack>
    </Container>
  );
}
