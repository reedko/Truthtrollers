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
  Button,
  IconButton,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useToast,
  useDisclosure,
} from "@chakra-ui/react";
import { FiUsers, FiActivity, FiBarChart2, FiClock, FiEdit2, FiTrash } from "react-icons/fi";
import { api } from "../../services/api";
import { useAuthStore } from "../../store/useAuthStore";

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
  const toast = useToast();
  const currentUser = useAuthStore((s) => s.user);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [newRole, setNewRole] = useState<string>("");
  const [availableRoles, setAvailableRoles] = useState<any[]>([]);
  const [userStatusFilter, setUserStatusFilter] = useState<"active" | "disabled" | "all">("active");
  const { isOpen, onOpen, onClose } = useDisclosure();

  // Load all users and roles for management
  useEffect(() => {
    loadAllUsers();
    loadRoles();
  }, []);

  const loadAllUsers = async () => {
    try {
      setLoadingUsers(true);
      const response = await api.get("/api/admin/users");
      setAllUsers(response.data.users || []);
    } catch (error) {
      console.error("Failed to load all users:", error);
      toast({
        title: "Error loading users",
        status: "error",
        duration: 3000,
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadRoles = async () => {
    try {
      const response = await api.get("/api/admin/roles");
      setAvailableRoles(response.data.roles || []);
    } catch (error) {
      console.error("Failed to load roles:", error);
      // Fallback to default roles
      setAvailableRoles([
        { role_id: 1, name: "user", description: "Standard user" },
        { role_id: 2, name: "admin", description: "Administrator" },
        { role_id: 3, name: "super_admin", description: "Super Administrator" },
      ]);
    }
  };

  const handleUpdateRole = async () => {
    if (!selectedUser || !newRole) return;

    try {
      await api.put(`/api/admin/users/${selectedUser.user_id}/role`, {
        role: newRole,
      });

      toast({
        title: "Role updated successfully",
        description: `${selectedUser.username} is now a ${newRole}`,
        status: "success",
        duration: 3000,
      });

      // Reload users
      await loadAllUsers();
      onClose();
    } catch (error: any) {
      console.error("Failed to update user role:", error);
      toast({
        title: "Error updating role",
        description: error.response?.data?.error || "Failed to update user role",
        status: "error",
        duration: 5000,
      });
    }
  };

  const toggleUserEnabled = async (user: any) => {
    const newEnabledStatus = !user.enabled;

    try {
      await api.put(`/api/admin/users/${user.user_id}/toggle-enabled`, {
        enabled: newEnabledStatus,
      });

      toast({
        title: newEnabledStatus ? "User enabled" : "User disabled",
        description: `${user.username} has been ${newEnabledStatus ? "enabled" : "disabled"}`,
        status: newEnabledStatus ? "success" : "warning",
        duration: 3000,
      });

      // Reload users
      await loadAllUsers();
    } catch (error: any) {
      console.error("Failed to toggle user enabled status:", error);
      toast({
        title: "Error updating user status",
        description: error.response?.data?.error || "Failed to update user status",
        status: "error",
        duration: 5000,
      });
    }
  };

  const openEditRoleModal = (user: any) => {
    setSelectedUser(user);
    setNewRole(user.role);
    onOpen();
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
              { icon: FiUsers, label: "Total Users", value: stats.totalUsers, subtext: `${onlineUsers.length} online`, color: "blue" },
              { icon: FiBarChart2, label: "Total Content", value: stats.totalContent, subtext: `${stats.totalClaims} claims`, color: "purple" },
              { icon: FiActivity, label: "Activities (24h)", value: stats.activitiesLast24h, subtext: "Last 24 hours", color: "green" },
              { icon: FiActivity, label: "Activities (7d)", value: stats.activitiesLast7d, subtext: "Last 7 days", color: "yellow" },
            ].map((stat, idx) => (
              <Box
                key={idx}
                className={`mr-card mr-card-${stat.color}`}
                position="relative"
                overflow="hidden"
                p={4}
                transition="all 0.3s"
              >
                <div className={`mr-glow-bar mr-glow-bar-${stat.color}`} />
                <div className="mr-scanlines" />
                <Stat position="relative" zIndex={1}>
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
              All Users
            </Tab>
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
            {/* All Users Tab */}
            <TabPanel px={0}>
              <VStack align="stretch" spacing={3}>
                <HStack justify="space-between">
                  <Text fontSize="lg" fontWeight="bold" color="cyan.300">
                    All Users ({allUsers.filter(u =>
                      userStatusFilter === "all" ? true :
                      userStatusFilter === "active" ? (u.enabled !== 0 && u.enabled !== false) :
                      (u.enabled === 0 || u.enabled === false)
                    ).length})
                  </Text>
                  <Button
                    size="sm"
                    colorScheme="cyan"
                    variant="outline"
                    onClick={loadAllUsers}
                    isLoading={loadingUsers}
                  >
                    Refresh
                  </Button>
                </HStack>

                {/* User Status Filter */}
                <HStack spacing={2}>
                  <Text fontSize="sm" color="gray.400">Show:</Text>
                  <Button
                    size="xs"
                    colorScheme={userStatusFilter === "active" ? "green" : "gray"}
                    variant={userStatusFilter === "active" ? "solid" : "outline"}
                    onClick={() => setUserStatusFilter("active")}
                  >
                    Active Users
                  </Button>
                  <Button
                    size="xs"
                    colorScheme={userStatusFilter === "disabled" ? "red" : "gray"}
                    variant={userStatusFilter === "disabled" ? "solid" : "outline"}
                    onClick={() => setUserStatusFilter("disabled")}
                  >
                    Disabled Users
                  </Button>
                  <Button
                    size="xs"
                    colorScheme={userStatusFilter === "all" ? "cyan" : "gray"}
                    variant={userStatusFilter === "all" ? "solid" : "outline"}
                    onClick={() => setUserStatusFilter("all")}
                  >
                    All Users
                  </Button>
                </HStack>

                {loadingUsers ? (
                  <Center py={10}>
                    <Spinner color="cyan.300" size="xl" />
                  </Center>
                ) : (
                  <Box
                    className="mr-card mr-card-blue"
                    position="relative"
                    overflow="hidden"
                    maxH="500px"
                    overflowY="auto"
                  >
                    <div className="mr-glow-bar mr-glow-bar-blue" />
                    <div className="mr-scanlines" />
                    <Table variant="simple" size="sm">
                      <Thead position="sticky" top={0} bg="rgba(15, 23, 42, 0.95)" zIndex={1}>
                        <Tr>
                          <Th color="gray.400" width="70px">Status</Th>
                          <Th color="gray.400" width="140px">Username</Th>
                          <Th color="gray.400" width="180px">Email</Th>
                          <Th color="gray.400" width="90px">Role</Th>
                          <Th color="gray.400" width="70px">Score</Th>
                          <Th color="gray.400" width="90px">Joined</Th>
                          <Th color="gray.400" width="100px">Last Login</Th>
                          <Th color="gray.400" width="90px">Actions</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {allUsers
                          .filter(user => {
                            if (userStatusFilter === "all") return true;
                            if (userStatusFilter === "active") return user.enabled !== 0 && user.enabled !== false;
                            if (userStatusFilter === "disabled") return user.enabled === 0 || user.enabled === false;
                            return true;
                          })
                          .map((user) => (
                          <Tr
                            key={user.user_id}
                            _hover={{ bg: "rgba(0, 162, 255, 0.05)" }}
                            opacity={user.enabled === false ? 0.5 : 1}
                          >
                            <Td>
                              <Text
                                color={user.is_online ? "green.400" : "red.500"}
                                fontSize="2xl"
                              >
                                {user.is_online ? "●" : "●"}
                              </Text>
                            </Td>
                            <Td color="gray.300" fontWeight="medium" fontSize="xs">
                              {user.username}
                              {user.isDemo && (
                                <Badge ml={1} colorScheme="orange" fontSize="xs">
                                  Demo
                                </Badge>
                              )}
                              {user.enabled === false && (
                                <Badge ml={1} colorScheme="red" fontSize="xs">
                                  Disabled
                                </Badge>
                              )}
                            </Td>
                            <Td color="gray.400" fontSize="xs">
                              {user.email}
                            </Td>
                            <Td>
                              <Badge
                                colorScheme={
                                  user.role === "super_admin"
                                    ? "purple"
                                    : user.role === "admin"
                                      ? "blue"
                                      : "gray"
                                }
                                fontSize="xs"
                              >
                                {user.role === "super_admin" ? "S" : user.role === "admin" ? "A" : "U"}
                              </Badge>
                            </Td>
                            <Td color="cyan.300" fontWeight="bold" fontSize="xs">
                              {user.verimeter_score !== null && user.verimeter_score !== undefined
                                ? Number(user.verimeter_score).toFixed(1)
                                : "N/A"}
                            </Td>
                            <Td color="gray.400" fontSize="xs">
                              {user.registered_at
                                ? new Date(user.registered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                                : "N/A"}
                            </Td>
                            <Td color="gray.400" fontSize="xs">
                              {user.last_accessed_at
                                ? new Date(user.last_accessed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                                : "Never"}
                            </Td>
                            <Td>
                              <HStack spacing={1}>
                                <IconButton
                                  size="xs"
                                  colorScheme="cyan"
                                  variant="outline"
                                  aria-label="Edit role"
                                  icon={<Icon as={FiEdit2} />}
                                  onClick={() => openEditRoleModal(user)}
                                  isDisabled={user.user_id === currentUser?.user_id && currentUser?.role !== 'super_admin'}
                                />
                                <IconButton
                                  size="xs"
                                  colorScheme={user.enabled === false ? "green" : "red"}
                                  variant="outline"
                                  aria-label={user.enabled === false ? "Enable user" : "Disable user"}
                                  icon={<Icon as={FiTrash} />}
                                  onClick={() => toggleUserEnabled(user)}
                                  isDisabled={user.user_id === currentUser?.user_id}
                                />
                              </HStack>
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </Box>
                )}
              </VStack>
            </TabPanel>

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
                  <Box
                    className="mr-card mr-card-blue"
                    position="relative"
                    overflow="hidden"
                    maxH="400px"
                    overflowY="auto"
                  >
                    <div className="mr-glow-bar mr-glow-bar-blue" />
                    <div className="mr-scanlines" />
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
                  <Box
                    className="mr-card mr-card-purple"
                    position="relative"
                    overflow="hidden"
                    maxH="400px"
                    overflowY="auto"
                  >
                    <div className="mr-glow-bar mr-glow-bar-purple" />
                    <div className="mr-scanlines" />
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
                  <Box
                    className="mr-card mr-card-green"
                    position="relative"
                    overflow="hidden"
                    maxH="400px"
                    overflowY="auto"
                  >
                    <div className="mr-glow-bar mr-glow-bar-green" />
                    <div className="mr-scanlines" />
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
                  <Box
                    className="mr-card mr-card-blue"
                    position="relative"
                    overflow="hidden"
                    maxH="400px"
                    overflowY="auto"
                  >
                    <div className="mr-glow-bar mr-glow-bar-blue" />
                    <div className="mr-scanlines" />
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
                  <Box
                    className="mr-card mr-card-yellow"
                    position="relative"
                    overflow="hidden"
                    maxH="400px"
                    overflowY="auto"
                  >
                    <div className="mr-glow-bar mr-glow-bar-yellow" />
                    <div className="mr-scanlines" />
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
                  <Box
                    className="mr-card mr-card-purple"
                    position="relative"
                    overflow="hidden"
                    maxH="400px"
                    overflowY="auto"
                  >
                    <div className="mr-glow-bar mr-glow-bar-purple" />
                    <div className="mr-scanlines" />
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

      {/* Edit Role Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered>
        <ModalOverlay bg="blackAlpha.800" backdropFilter="blur(10px)" />
        <ModalContent
          className="mr-card mr-card-purple"
          position="relative"
        >
          <div className="mr-glow-bar mr-glow-bar-purple" />
          <div className="mr-scanlines" />
          <ModalHeader color="purple.300">
            Edit User Role
          </ModalHeader>
          <ModalCloseButton color="gray.400" />
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <Box>
                <Text color="gray.400" fontSize="sm" mb={1}>
                  User
                </Text>
                <Text color="white" fontWeight="bold">
                  {selectedUser?.username} ({selectedUser?.email})
                </Text>
              </Box>
              <Box>
                <Text color="gray.400" fontSize="sm" mb={2}>
                  Current Role
                </Text>
                <Badge
                  colorScheme={
                    selectedUser?.role === "super_admin"
                      ? "purple"
                      : selectedUser?.role === "admin"
                        ? "blue"
                        : "gray"
                  }
                  fontSize="md"
                  px={3}
                  py={1}
                >
                  {selectedUser?.role}
                </Badge>
              </Box>
              <Box>
                <Text color="gray.400" fontSize="sm" mb={2}>
                  New Role
                </Text>
                <Select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  bg="rgba(15, 23, 42, 0.8)"
                  borderColor="rgba(0, 162, 255, 0.3)"
                  color="white"
                  _hover={{ borderColor: "cyan.300" }}
                  _focus={{ borderColor: "cyan.300", boxShadow: "0 0 0 1px rgba(0, 162, 255, 0.5)" }}
                >
                  <option value="" style={{ background: "#0f172a" }}>
                    Select a role...
                  </option>
                  {availableRoles.map((role) => (
                    <option key={role.role_id} value={role.name} style={{ background: "#0f172a" }}>
                      {role.name.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                    </option>
                  ))}
                </Select>
              </Box>
              <Box
                bg="rgba(139, 92, 246, 0.1)"
                borderWidth="1px"
                borderColor="purple.500"
                borderRadius="md"
                p={3}
              >
                <Text color="purple.300" fontSize="xs">
                  <strong>Note:</strong> Changing a user to Super Admin will grant them full access
                  to this admin panel and all administrative functions.
                </Text>
              </Box>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={3}>
              <Button
                variant="outline"
                colorScheme="gray"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                colorScheme="cyan"
                onClick={handleUpdateRole}
                isDisabled={!newRole || newRole === selectedUser?.role}
              >
                Update Role
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
