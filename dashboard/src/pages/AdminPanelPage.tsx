import React, { useState, useEffect } from "react";
import {
  Box,
  Container,
  Heading,
  VStack,
  HStack,
  Badge,
  useToast,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
} from "@chakra-ui/react";
import { api } from "../services/api";
import { useAuthStore } from "../store/useAuthStore";
import { useNavigate } from "react-router-dom";
import EvidenceOpsPanel from "../components/admin/EvidenceOpsPanel";
import UserOpsPanel from "../components/admin/UserOpsPanel";

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

  if (user?.role !== "super_admin") {
    return null;
  }

  return (
    <Box
      minH="100vh"
      bg="radial-gradient(circle at bottom right, rgba(0, 162, 255, 0.15) 0%, rgba(2, 0, 36, 0.95) 50%)"
      position="relative"
    >
      {/* Scanline overlay for entire page */}
      <Box
        position="fixed"
        inset="0"
        bgImage="repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.02) 2px, rgba(0, 162, 255, 0.02) 4px)"
        pointerEvents="none"
        zIndex={0}
      />

      <Container maxW="container.xl" py={8} position="relative" zIndex={1}>
        <VStack spacing={8} align="stretch">
          {/* Header */}
          <HStack justify="space-between">
            <VStack align="start" spacing={1}>
              <Heading
                size="2xl"
                bgGradient="linear(to-r, cyan.300, blue.400)"
                bgClip="text"
                textShadow="0 0 20px rgba(0, 162, 255, 0.5)"
              >
                Admin Panel
              </Heading>
              <HStack>
                <Badge
                  colorScheme="purple"
                  fontSize="md"
                  px={3}
                  py={1}
                  borderRadius="md"
                  boxShadow="0 0 10px rgba(139, 92, 246, 0.3)"
                >
                  Super Admin
                </Badge>
                <Badge
                  colorScheme="cyan"
                  fontSize="sm"
                  px={2}
                  py={1}
                  borderRadius="md"
                  variant="outline"
                >
                  {user?.username}
                </Badge>
              </HStack>
            </VStack>
          </HStack>

          {/* Main Tabs - User Ops vs Evidence Ops */}
          <Tabs variant="unstyled" colorScheme="cyan">
            <TabList
              bg="rgba(15, 23, 42, 0.6)"
              backdropFilter="blur(10px)"
              borderRadius="md"
              p={1}
              borderWidth="1px"
              borderColor="rgba(0, 162, 255, 0.3)"
            >
              <Tab
                _selected={{
                  bg: "linear-gradient(135deg, rgba(0, 162, 255, 0.3), rgba(139, 92, 246, 0.2))",
                  color: "cyan.300",
                  boxShadow: "0 0 20px rgba(0, 162, 255, 0.3)",
                }}
                borderRadius="md"
                fontWeight="bold"
                fontSize="lg"
                color="gray.400"
                transition="all 0.3s"
              >
                User Operations
              </Tab>
              <Tab
                _selected={{
                  bg: "linear-gradient(135deg, rgba(0, 162, 255, 0.3), rgba(139, 92, 246, 0.2))",
                  color: "cyan.300",
                  boxShadow: "0 0 20px rgba(0, 162, 255, 0.3)",
                }}
                borderRadius="md"
                fontWeight="bold"
                fontSize="lg"
                color="gray.400"
                transition="all 0.3s"
              >
                Evidence Operations
              </Tab>
            </TabList>

            <TabPanels>
              <TabPanel px={0} pt={6}>
                <UserOpsPanel
                  onlineUsers={onlineUsers}
                  activities={activities}
                  stats={stats}
                  loginAttempts={loginAttempts}
                  registrationAttempts={registrationAttempts}
                  loginEvents={loginEvents}
                  loading={loading}
                  activityFilter={activityFilter}
                  setActivityFilter={setActivityFilter}
                  loginFilter={loginFilter}
                  setLoginFilter={setLoginFilter}
                  registrationFilter={registrationFilter}
                  setRegistrationFilter={setRegistrationFilter}
                  loginEventFilter={loginEventFilter}
                  setLoginEventFilter={setLoginEventFilter}
                />
              </TabPanel>
              <TabPanel px={0} pt={6}>
                <EvidenceOpsPanel />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>
      </Container>
    </Box>
  );
}
