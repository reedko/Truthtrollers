import React, { useState, useEffect } from "react";
import {
  Box,
  VStack,
  HStack,
  Text,
  Badge,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Spinner,
  Center,
  Icon,
  Select,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Divider,
  Grid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
} from "@chakra-ui/react";
import { FiUsers, FiActivity, FiBarChart2, FiClock } from "react-icons/fi";
import { api } from "../../services/api";

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

interface UserOpsPanelProps {
  onlineUsers: OnlineUser[];
  activities: Activity[];
  stats: Stats | null;
  loginAttempts: LoginAttempt[];
  registrationAttempts: RegistrationAttempt[];
  loginEvents: LoginEvent[];
  loading: boolean;
  activityFilter: string;
  setActivityFilter: (filter: string) => void;
  loginFilter: string;
  setLoginFilter: (filter: string) => void;
  registrationFilter: string;
  setRegistrationFilter: (filter: string) => void;
  loginEventFilter: string;
  setLoginEventFilter: (filter: string) => void;
}

export default function UserOpsPanel({
  onlineUsers,
  activities,
  stats,
  loginAttempts,
  registrationAttempts,
  loginEvents,
  loading,
  activityFilter,
  setActivityFilter,
  loginFilter,
  setLoginFilter,
  registrationFilter,
  setRegistrationFilter,
  loginEventFilter,
  setLoginEventFilter,
}: UserOpsPanelProps) {
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

  return (
    <Box
      bg="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
      backdropFilter="blur(20px)"
      borderWidth="1px"
      borderColor="rgba(0, 162, 255, 0.4)"
      borderRadius="12px"
      p={6}
      position="relative"
      overflow="hidden"
      boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.2)"
    >
      {/* Scanline overlay */}
      <Box
        position="absolute"
        inset="0"
        bgImage="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.03) 2px, rgba(0, 162, 255, 0.03) 4px)"
        pointerEvents="none"
        zIndex={0}
      />

      <VStack spacing={6} align="stretch" position="relative" zIndex={1}>
        {/* Header */}
        <HStack justify="space-between">
          <VStack align="start" spacing={1}>
            <Text fontSize="2xl" fontWeight="bold" color="cyan.300" textShadow="0 0 10px rgba(0, 162, 255, 0.5)">
              User Operations
            </Text>
            <Text fontSize="sm" color="gray.400">
              Monitor users, activities, and security events
            </Text>
          </VStack>
        </HStack>

        <Divider borderColor="cyan.700" opacity={0.3} />

        {/* Stats Grid */}
        {loading && !stats ? (
          <Center py={10}>
            <Spinner size="xl" color="cyan.400" />
          </Center>
        ) : stats ? (
          <Grid
            templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }}
            gap={4}
          >
            {[
              { icon: FiUsers, label: "Total Users", value: stats.totalUsers, subtext: `${onlineUsers.length} online` },
              { icon: FiBarChart2, label: "Total Content", value: stats.totalContent, subtext: `${stats.totalClaims} claims` },
              { icon: FiActivity, label: "Activities (24h)", value: stats.activitiesLast24h, subtext: "Last 24 hours" },
              { icon: FiActivity, label: "Activities (7d)", value: stats.activitiesLast7d, subtext: "Last 7 days" },
            ].map((stat, idx) => (
              <Box
                key={idx}
                bg="rgba(0, 162, 255, 0.05)"
                borderWidth="1px"
                borderColor="rgba(0, 162, 255, 0.3)"
                borderRadius="md"
                p={4}
                _hover={{
                  borderColor: "cyan.400",
                  boxShadow: "0 0 20px rgba(0, 162, 255, 0.3)",
                  transform: "translateY(-2px)",
                }}
                transition="all 0.3s"
              >
                <Stat>
                  <HStack mb={2}>
                    <Icon as={stat.icon} boxSize={5} color="cyan.400" />
                    <StatLabel color="gray.300" fontSize="sm">{stat.label}</StatLabel>
                  </HStack>
                  <StatNumber color="cyan.300" fontSize="2xl">{stat.value}</StatNumber>
                  <StatHelpText color="gray.500" fontSize="xs">{stat.subtext}</StatHelpText>
                </Stat>
              </Box>
            ))}
          </Grid>
        ) : null}

        {/* Tabs */}
        <Tabs variant="soft-rounded" colorScheme="cyan">
          <TabList flexWrap="wrap" gap={2}>
            <Tab _selected={{ bg: "rgba(0, 162, 255, 0.2)", color: "cyan.300" }} fontSize="sm">
              Online Users
            </Tab>
            <Tab _selected={{ bg: "rgba(0, 162, 255, 0.2)", color: "cyan.300" }} fontSize="sm">
              Activities
            </Tab>
            <Tab _selected={{ bg: "rgba(0, 162, 255, 0.2)", color: "cyan.300" }} fontSize="sm">
              Login Attempts
            </Tab>
            <Tab _selected={{ bg: "rgba(0, 162, 255, 0.2)", color: "cyan.300" }} fontSize="sm">
              Login Events
            </Tab>
            <Tab _selected={{ bg: "rgba(0, 162, 255, 0.2)", color: "cyan.300" }} fontSize="sm">
              Registrations
            </Tab>
            <Tab _selected={{ bg: "rgba(0, 162, 255, 0.2)", color: "cyan.300" }} fontSize="sm">
              Top Contributors
            </Tab>
          </TabList>

          <TabPanels>
            {/* Online Users Tab */}
            <TabPanel px={0}>
              <VStack align="stretch" spacing={3}>
                <HStack justify="space-between">
                  <Text fontSize="lg" fontWeight="bold" color="cyan.300">
                    Online Users ({onlineUsers.length})
                  </Text>
                  <HStack fontSize="xs" color="gray.400">
                    <Icon as={FiClock} />
                    <Text>Active in last 15 minutes</Text>
                  </HStack>
                </HStack>
                {loading ? (
                  <Center py={10}>
                    <Spinner color="cyan.400" />
                  </Center>
                ) : onlineUsers.length === 0 ? (
                  <Center py={10}>
                    <Text color="gray.500">No users currently online</Text>
                  </Center>
                ) : (
                  <Box overflowX="auto" maxH="400px" overflowY="auto">
                    <Table variant="simple" size="sm">
                      <Thead position="sticky" top={0} bg="rgba(15, 23, 42, 0.95)" zIndex={1}>
                        <Tr>
                          <Th color="gray.400">Username</Th>
                          <Th color="gray.400">Email</Th>
                          <Th color="gray.400">Role</Th>
                          <Th color="gray.400">Last Active</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {onlineUsers.map((user) => (
                          <Tr key={user.user_id} _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}>
                            <Td>
                              <HStack>
                                <Box w={2} h={2} borderRadius="full" bg="green.400" />
                                <Text fontWeight="bold" color="gray.200">{user.username}</Text>
                              </HStack>
                            </Td>
                            <Td color="gray.400" fontSize="sm">{user.email}</Td>
                            <Td>
                              <Badge colorScheme={user.role === "super_admin" ? "purple" : "blue"}>
                                {user.role}
                              </Badge>
                            </Td>
                            <Td color="gray.400" fontSize="sm">{formatTimeAgo(user.last_active)}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                )}
              </VStack>
            </TabPanel>

            {/* Activities Tab */}
            <TabPanel px={0}>
              <VStack align="stretch" spacing={3}>
                <HStack justify="space-between">
                  <Text fontSize="lg" fontWeight="bold" color="cyan.300">
                    Recent Activity ({activities.length})
                  </Text>
                  <Select
                    value={activityFilter}
                    onChange={(e) => setActivityFilter(e.target.value)}
                    w="200px"
                    size="sm"
                    bg="rgba(0, 0, 0, 0.4)"
                    borderColor="cyan.600"
                  >
                    <option value="all" style={{ background: "#1a202c" }}>All Activities</option>
                    <option value="evidence_run" style={{ background: "#1a202c" }}>Evidence Runs</option>
                    <option value="claim_link_add" style={{ background: "#1a202c" }}>Claim Links Added</option>
                    <option value="claim_link_evaluate" style={{ background: "#1a202c" }}>Link Evaluations</option>
                    <option value="task_view" style={{ background: "#1a202c" }}>Case Views</option>
                    <option value="discussion_post" style={{ background: "#1a202c" }}>Discussion Posts</option>
                  </Select>
                </HStack>
                {loading ? (
                  <Center py={10}>
                    <Spinner color="cyan.400" />
                  </Center>
                ) : activities.length === 0 ? (
                  <Center py={10}>
                    <Text color="gray.500">No recent activities</Text>
                  </Center>
                ) : (
                  <Box overflowX="auto" maxH="400px" overflowY="auto">
                    <Table variant="simple" size="sm">
                      <Thead position="sticky" top={0} bg="rgba(15, 23, 42, 0.95)" zIndex={1}>
                        <Tr>
                          <Th color="gray.400">User</Th>
                          <Th color="gray.400">Activity</Th>
                          <Th color="gray.400">Content</Th>
                          <Th color="gray.400">Time</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {activities.map((activity) => (
                          <Tr key={activity.activity_id} _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}>
                            <Td color="gray.300">
                              {activity.user_username || activity.username || "Guest"}
                            </Td>
                            <Td>
                              <Badge colorScheme={getActivityBadgeColor(activity.activity_type)} fontSize="xs">
                                {activity.activity_type.replace(/_/g, " ")}
                              </Badge>
                            </Td>
                            <Td color="gray.400" fontSize="sm">
                              {activity.content_title || `Content #${activity.content_id}`}
                            </Td>
                            <Td color="gray.400" fontSize="sm">{formatTimeAgo(activity.created_at)}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                )}
              </VStack>
            </TabPanel>

            {/* Login Attempts Tab */}
            <TabPanel px={0}>
              <VStack align="stretch" spacing={3}>
                <HStack justify="space-between">
                  <Text fontSize="lg" fontWeight="bold" color="cyan.300">
                    Login Attempts ({loginAttempts.length})
                  </Text>
                  <Select
                    value={loginFilter}
                    onChange={(e) => setLoginFilter(e.target.value)}
                    w="150px"
                    size="sm"
                    bg="rgba(0, 0, 0, 0.4)"
                    borderColor="cyan.600"
                  >
                    <option value="all" style={{ background: "#1a202c" }}>All</option>
                    <option value="true" style={{ background: "#1a202c" }}>Success</option>
                    <option value="false" style={{ background: "#1a202c" }}>Failed</option>
                  </Select>
                </HStack>
                {loading ? (
                  <Center py={10}>
                    <Spinner color="cyan.400" />
                  </Center>
                ) : loginAttempts.length === 0 ? (
                  <Center py={10}>
                    <Text color="gray.500">No login attempts recorded</Text>
                  </Center>
                ) : (
                  <Box overflowX="auto" maxH="400px" overflowY="auto">
                    <Table variant="simple" size="sm">
                      <Thead position="sticky" top={0} bg="rgba(15, 23, 42, 0.95)" zIndex={1}>
                        <Tr>
                          <Th color="gray.400">Username</Th>
                          <Th color="gray.400">Status</Th>
                          <Th color="gray.400">Reason</Th>
                          <Th color="gray.400">IP Address</Th>
                          <Th color="gray.400">Time</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {loginAttempts.map((attempt) => (
                          <Tr key={attempt.id} _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}>
                            <Td color="gray.300" fontWeight="medium">{attempt.username}</Td>
                            <Td>
                              <Badge colorScheme={attempt.success ? "green" : "red"} fontSize="xs">
                                {attempt.success ? "Success" : "Failed"}
                              </Badge>
                            </Td>
                            <Td color="gray.400" fontSize="sm">{attempt.reason || "-"}</Td>
                            <Td color="gray.400" fontSize="sm" fontFamily="mono">{attempt.ip_address}</Td>
                            <Td color="gray.400" fontSize="sm">{formatTimeAgo(attempt.created_at)}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                )}
              </VStack>
            </TabPanel>

            {/* Login Events Tab */}
            <TabPanel px={0}>
              <VStack align="stretch" spacing={3}>
                <HStack justify="space-between">
                  <Text fontSize="lg" fontWeight="bold" color="cyan.300">
                    Login Events ({loginEvents.length})
                  </Text>
                  <Select
                    value={loginEventFilter}
                    onChange={(e) => setLoginEventFilter(e.target.value)}
                    w="200px"
                    size="sm"
                    bg="rgba(0, 0, 0, 0.4)"
                    borderColor="cyan.600"
                  >
                    <option value="all" style={{ background: "#1a202c" }}>All Events</option>
                    <option value="login" style={{ background: "#1a202c" }}>Logins</option>
                    <option value="logout" style={{ background: "#1a202c" }}>Logouts</option>
                    <option value="password_reset_request" style={{ background: "#1a202c" }}>Password Resets</option>
                    <option value="password_changed" style={{ background: "#1a202c" }}>Password Changes</option>
                  </Select>
                </HStack>
                {loading ? (
                  <Center py={10}>
                    <Spinner color="cyan.400" />
                  </Center>
                ) : loginEvents.length === 0 ? (
                  <Center py={10}>
                    <Text color="gray.500">No login events recorded</Text>
                  </Center>
                ) : (
                  <Box overflowX="auto" maxH="400px" overflowY="auto">
                    <Table variant="simple" size="sm">
                      <Thead position="sticky" top={0} bg="rgba(15, 23, 42, 0.95)" zIndex={1}>
                        <Tr>
                          <Th color="gray.400">Username</Th>
                          <Th color="gray.400">Event Type</Th>
                          <Th color="gray.400">IP Address</Th>
                          <Th color="gray.400">Fingerprint</Th>
                          <Th color="gray.400">Time</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {loginEvents.map((event) => (
                          <Tr key={event.id} _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}>
                            <Td color="gray.300" fontWeight="medium">{event.username || `User #${event.user_id}`}</Td>
                            <Td>
                              <Badge
                                colorScheme={
                                  event.event_type === "login" ? "green" :
                                  event.event_type === "logout" ? "orange" :
                                  "blue"
                                }
                                fontSize="xs"
                              >
                                {event.event_type.replace(/_/g, " ")}
                              </Badge>
                            </Td>
                            <Td color="gray.400" fontSize="sm" fontFamily="mono">{event.ip_address}</Td>
                            <Td color="gray.400" fontSize="xs" fontFamily="mono">{event.fingerprint.substring(0, 20)}...</Td>
                            <Td color="gray.400" fontSize="sm">{formatTimeAgo(event.created_at)}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                )}
              </VStack>
            </TabPanel>

            {/* Registrations Tab */}
            <TabPanel px={0}>
              <VStack align="stretch" spacing={3}>
                <HStack justify="space-between">
                  <Text fontSize="lg" fontWeight="bold" color="cyan.300">
                    Registration Attempts ({registrationAttempts.length})
                  </Text>
                  <Select
                    value={registrationFilter}
                    onChange={(e) => setRegistrationFilter(e.target.value)}
                    w="150px"
                    size="sm"
                    bg="rgba(0, 0, 0, 0.4)"
                    borderColor="cyan.600"
                  >
                    <option value="all" style={{ background: "#1a202c" }}>All</option>
                    <option value="true" style={{ background: "#1a202c" }}>Success</option>
                    <option value="false" style={{ background: "#1a202c" }}>Failed</option>
                  </Select>
                </HStack>
                {loading ? (
                  <Center py={10}>
                    <Spinner color="cyan.400" />
                  </Center>
                ) : registrationAttempts.length === 0 ? (
                  <Center py={10}>
                    <Text color="gray.500">No registration attempts recorded</Text>
                  </Center>
                ) : (
                  <Box overflowX="auto" maxH="400px" overflowY="auto">
                    <Table variant="simple" size="sm">
                      <Thead position="sticky" top={0} bg="rgba(15, 23, 42, 0.95)" zIndex={1}>
                        <Tr>
                          <Th color="gray.400">Username</Th>
                          <Th color="gray.400">Email</Th>
                          <Th color="gray.400">Status</Th>
                          <Th color="gray.400">Message</Th>
                          <Th color="gray.400">IP Address</Th>
                          <Th color="gray.400">Time</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {registrationAttempts.map((attempt) => (
                          <Tr key={attempt.id} _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}>
                            <Td color="gray.300" fontWeight="medium">{attempt.username}</Td>
                            <Td color="gray.400" fontSize="sm">{attempt.email}</Td>
                            <Td>
                              <Badge colorScheme={attempt.success ? "green" : "red"} fontSize="xs">
                                {attempt.success ? "Success" : "Failed"}
                              </Badge>
                            </Td>
                            <Td color="gray.400" fontSize="sm">{attempt.message || "-"}</Td>
                            <Td color="gray.400" fontSize="sm" fontFamily="mono">{attempt.ip_address}</Td>
                            <Td color="gray.400" fontSize="sm">{formatTimeAgo(attempt.created_at)}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                )}
              </VStack>
            </TabPanel>

            {/* Top Contributors Tab */}
            <TabPanel px={0}>
              <VStack align="stretch" spacing={3}>
                <Text fontSize="lg" fontWeight="bold" color="cyan.300">
                  Top Contributors
                </Text>
                {loading || !stats ? (
                  <Center py={10}>
                    <Spinner color="cyan.400" />
                  </Center>
                ) : !stats.topContributors || stats.topContributors.length === 0 ? (
                  <Center py={10}>
                    <Text color="gray.500">No contributor data available</Text>
                  </Center>
                ) : (
                  <Box overflowX="auto" maxH="400px" overflowY="auto">
                    <Table variant="simple" size="sm">
                      <Thead position="sticky" top={0} bg="rgba(15, 23, 42, 0.95)" zIndex={1}>
                        <Tr>
                          <Th color="gray.400">Rank</Th>
                          <Th color="gray.400">Username</Th>
                          <Th color="gray.400" isNumeric>Activity Count</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {stats.topContributors.map((contributor, index) => (
                          <Tr key={contributor.user_id} _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}>
                            <Td>
                              <Badge
                                colorScheme={
                                  index === 0 ? "yellow" :
                                  index === 1 ? "gray" :
                                  index === 2 ? "orange" :
                                  "blue"
                                }
                                fontSize="sm"
                              >
                                #{index + 1}
                              </Badge>
                            </Td>
                            <Td color="gray.300" fontWeight="medium">{contributor.username}</Td>
                            <Td color="cyan.300" fontSize="lg" fontWeight="bold" isNumeric>
                              {contributor.activity_count}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                )}
              </VStack>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </VStack>
    </Box>
  );
}
