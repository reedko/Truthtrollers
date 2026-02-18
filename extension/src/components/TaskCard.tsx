import React, { useEffect, useState, useRef } from "react";
import {
  Box,
  Button,
  GridItem,
  Progress,
  Text,
  Grid,
  VStack,
  HStack,
  Spacer,
  Center,
  Stat,
  Tooltip,
} from "@chakra-ui/react";
import "./Popup.css";
import "../styles/minorityReport.css";
import UserConsensusBar from "./UserConsensusBar";
import useTaskStore from "../store/useTaskStore";
import resizeImage from "../services/image-url";
import { useTaskScraper } from "../hooks/useTaskScraper";
import TruthGauge from "./ModernArcGauge";
import browser from "webextension-polyfill";
import { Task } from "../entities/Task";
import {
  getFacebookPostUrl,
  isFacebookPost,
} from "../services/scrapeFacebookPost";

// Keep your base URL logic
const BASE_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_EXTENSION_BASE_URL) ||
  process.env.REACT_APP_EXTENSION_BASE_URL ||
  "https://localhost:5001";

// --- helper: ask background for bytes → build blob: URL (matches getAssetBlobUrl action) ---
async function getBlobUrl(pathOrUrl: string): Promise<string> {
  const resp = (await browser.runtime.sendMessage({
    action: "getAssetBlobUrl",
    url: pathOrUrl,
  })) as { ok: boolean; base64?: string; type?: string; error?: string };

  if (!resp?.ok || !resp.base64)
    throw new Error(resp?.error || "Failed to fetch asset bytes");

  const bytes = Uint8Array.from(atob(resp.base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: resp.type || "application/octet-stream",
  });
  return URL.createObjectURL(blob);
}

const getProgressColor = (progress: string | null) => {
  switch (progress) {
    case "Completed":
      return "green";
    case "Partially Complete":
      return "yellow";
    case "Awaiting Evaluation":
      return "blue";
    default:
      return "red";
  }
};

const TaskCard: React.FC = () => {
  const { task, currentUrl, setTask, setCurrentUrl } = useTaskStore();
  const { loading, error, scrapeTask } = useTaskScraper();
  const [visible, setVisible] = useState(false);

  // blob URLs we render (logo / meter / content thumb)
  const [logoBlob, setLogoBlob] = useState<string>("");
  const [meterBlob, setMeterBlob] = useState<string>("");
  const [thumbBlob, setThumbBlob] = useState<string>("");

  // track blobs to revoke on unmount
  const blobPool = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      blobPool.current.forEach((u) => URL.revokeObjectURL(u));
      blobPool.current = [];
    };
  }, []);

  async function getResolvedUrl(): Promise<string> {
    const storeUrl = useTaskStore.getState().currentUrl;
    if (typeof storeUrl === "string" && storeUrl) return storeUrl;

    // Fallback: read currentUrl directly from storage (set by background before injection)
    const { currentUrl } = (await browser.storage.local.get("currentUrl")) as {
      currentUrl?: unknown;
    };

    return typeof currentUrl === "string" ? currentUrl : "";
  }

  // Detect Facebook post URL on mount and update currentUrl
  // BUT only if we don't already have a URL in storage
  useEffect(() => {
    const detectFacebookUrl = async () => {
      const pageUrl = window.location.href;

      // Only detect if on Facebook
      if (!isFacebookPost(pageUrl)) return;

      // Check if we already have a URL stored
      const stored = await browser.storage.local.get("currentUrl");
      if (stored.currentUrl && typeof stored.currentUrl === "string") {
        console.log(
          `🔵 [TaskCard] Already have stored URL: ${stored.currentUrl}`,
        );
        setCurrentUrl(stored.currentUrl);
        return;
      }

      // Only if no stored URL, detect it (this opens embed dialog)
      console.log(
        `🔵 [TaskCard] No stored URL, detecting Facebook post URL...`,
      );
      const postUrl = await getFacebookPostUrl();
      if (postUrl) {
        console.log(`🔵 [TaskCard] Detected Facebook post URL: ${postUrl}`);
        setCurrentUrl(postUrl);
        await browser.storage.local.set({ currentUrl: postUrl });
      }
    };

    // Only run once on mount
    detectFacebookUrl();
  }, []); // Empty dependency array = only run once

  useEffect(() => {
    // ✅ Retrieve task data from local storage
    browser.storage.local
      .get("task")
      .then((data) => {
        const storedTask = data.task as Task | undefined;
        if (storedTask) {
          setTask(storedTask);
          setVisible(true);
        }
      })
      .catch((err) => {
        console.error("Failed to get task from storage:", err);
      });
  }, [setTask]);

  // Load static UI assets (logo, meter) from bundled extension assets - INSTANT!
  useEffect(() => {
    try {
      // Use browser.runtime.getURL for bundled assets - no network fetch needed
      const logo = browser.runtime.getURL("assets/images/miniLogo.png");
      const meter = browser.runtime.getURL("assets/images/meter3.png");
      setLogoBlob(logo);
      setMeterBlob(meter);
      // These aren't blob URLs, so no need to track for revocation
    } catch (e) {
      console.warn("Static asset load failed:", e);
    }
  }, []);

  // Track thumbnail loading state to prevent showing wrong popup
  const [thumbLoading, setThumbLoading] = React.useState(false);

  // Load the content thumbnail (dynamic) via background → blob
  useEffect(() => {
    (async () => {
      if (!task?.thumbnail) {
        setThumbBlob("");
        setThumbLoading(false);
        return;
      }

      setThumbLoading(true);
      try {
        const full = task.thumbnail.startsWith("http")
          ? task.thumbnail
          : `${BASE_URL}/${task.thumbnail}`;
        const blobUrl = await getBlobUrl(full);
        setThumbBlob(blobUrl);
        blobPool.current.push(blobUrl);
      } catch (e) {
        console.warn("Thumb blob fetch failed:", e);
        setThumbBlob("");
      } finally {
        setThumbLoading(false);
      }
    })();
  }, [task?.thumbnail]);

  const handleAddTask = async () => {
    const url = await getResolvedUrl();
    if (!url) {
      console.error("No URL available.");
      return;
    }
    if (currentUrl) {
      scrapeTask(currentUrl);
    } else {
      console.error("No URL provided.");
    }
  };

  const handleArgueClick = () => {
    if (!task) return;
    const url = `${process.env.REACT_APP_EXTENSION_URL}/discussion/${task.content_id}`;
    browser.runtime.sendMessage({ fn: "openDiscussionTab", url });
  };

  // Render with BLOB URLs (no page → localhost/network fetch)
  const imageUrl = thumbBlob || "";
  const meter = meterBlob || "";
  const logo = logoBlob || "";

  return (
    <Box
      className="popup-box"
      width="300px"
      position="relative"
      bgGradient="linear(135deg, rgba(10, 30, 60, 0.75), rgba(20, 50, 80, 0.7))"
      sx={{
        backgroundImage: `
          linear-gradient(135deg, rgba(10, 30, 60, 0.75), rgba(20, 50, 80, 0.7)),
          repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 162, 255, 0.08) 2px, rgba(0, 162, 255, 0.08) 4px)
        `,
      }}
      border="1px solid rgba(0, 162, 255, 0.6)"
      borderRadius="12px"
      boxShadow="0 10px 40px rgba(0, 0, 0, 0.7), 0 0 50px rgba(0, 162, 255, 0.6), inset 0 2px 0 rgba(255, 255, 255, 0.2)"
      overflow="hidden"
      p={3}
    >
      <Box
        position="absolute"
        left={0}
        top={0}
        width="50px"
        height="100%"
        background="linear-gradient(90deg, rgba(0, 217, 255, 0.6) 0%, rgba(0, 217, 255, 0.4) 25%, rgba(0, 217, 255, 0.25) 50%, rgba(0, 217, 255, 0.1) 75%, transparent 100%)"
        pointerEvents="none"
      />
      <VStack
        spacing={2}
        align="start"
        position="relative"
        zIndex={1}
        style={{ background: "none" }}
        width="100%"
      >
        <Box
          className="logo-box"
          position="relative"
          background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
          backdropFilter="blur(20px)"
          border="1px solid rgba(0, 162, 255, 0.4)"
          borderRadius="12px"
          boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
          overflow="hidden"
          p={2}
          width="100%"
        >
          <Box
            position="absolute"
            left={0}
            top={0}
            width="30px"
            height="100%"
            background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
            pointerEvents="none"
          />
          <HStack
            spacing={2}
            position="relative"
            zIndex={1}
            justify="space-between"
            align="center"
          >
            <Box flexShrink={0}>{logo && resizeImage(40, logo)}</Box>
            <Text
              color="#00a2ff"
              fontWeight="400"
              letterSpacing="3px"
              textTransform="uppercase"
              fontSize="xl"
              fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
            >
              TruthTrollers
            </Text>
          </HStack>
        </Box>

        {!thumbLoading && imageUrl && task?.progress === "Completed" ? (
          <HStack
            spacing={1}
            align="flex-start"
            width="100%"
            justify="space-between"
            mt={2}
            px={1}
          >
            <Box flexShrink={0}>
              <TruthGauge
                score={-0.73}
                label="VERIMETER"
                size={{ w: 170, h: 90 }}
                normalize={false}
              />
            </Box>
            <Box
              position="relative"
              background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
              backdropFilter="blur(20px)"
              border="1px solid rgba(0, 162, 255, 0.5)"
              borderRadius="12px"
              boxShadow="0 10px 40px rgba(0, 0, 0, 0.7), 0 0 50px rgba(0, 162, 255, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
              overflow="hidden"
              flexShrink={0}
              width="70px"
              height="180px"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <Box
                position="absolute"
                left={0}
                top={0}
                width="15px"
                height="100%"
                background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
                pointerEvents="none"
              />
              <Box
                position="relative"
                zIndex={1}
                transform="scale(0.85)"
                ml={-35}
                mr={-35}
              >
                <UserConsensusBar trueCount={21} falseCount={71} total={121} />
              </Box>
            </Box>
          </HStack>
        ) : (
          !thumbLoading &&
          imageUrl && (
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              width="100%"
            >
              {resizeImage(120, imageUrl)}
            </Box>
          )
        )}

        {thumbLoading ? (
          <Box width="100%" py={4}>
            <Center>
              <Text color="#00a2ff" fontSize="sm">
                Loading...
              </Text>
            </Center>
          </Box>
        ) : imageUrl ? (
          <Box width="280px">
            <Box width="100%" mb={2}>
              <Tooltip label={task?.content_name || "No title"} fontSize="sm">
                <Text
                  fontSize="lg"
                  fontWeight="bold"
                  isTruncated
                  whiteSpace="nowrap"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  color="white"
                  px={1}
                >
                  {(task?.url && isFacebookPost(task.url)
                    ? "Facebook Post"
                    : task?.content_name) || "Unknown Content"}
                </Text>
              </Tooltip>
            </Box>

            <Center mt={3}>
              <HStack spacing={3}>
                <button className="mr-button" onClick={handleArgueClick}>
                  <span style={{ position: "relative", zIndex: 1 }}>
                    Discuss
                  </span>
                </button>
                <button
                  className="mr-button"
                  onClick={() => {
                    setVisible(false);
                    const popupRoot = document.getElementById("popup-root");
                    if (popupRoot) {
                      popupRoot.classList.add("task-card-hidden");
                      popupRoot.classList.remove("task-card-visible");
                    }
                  }}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>Close</span>
                </button>
              </HStack>
            </Center>
          </Box>
        ) : (
          <Box width="100%">
            <Box width="100%" mb={3}>
              <Tooltip
                label={task?.content_name || currentUrl || document.title}
                fontSize="sm"
              >
                <Text
                  fontWeight="bold"
                  fontSize="md"
                  noOfLines={2}
                  color="#f1f5f9"
                >
                  {task?.content_name ||
                    (currentUrl && isFacebookPost(currentUrl)
                      ? "Facebook Post"
                      : currentUrl) ||
                    document.title ||
                    "Current Page"}
                </Text>
              </Tooltip>
            </Box>
            <Box
              position="relative"
              background="linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.9))"
              backdropFilter="blur(20px)"
              border="1px solid rgba(0, 162, 255, 0.4)"
              borderRadius="12px"
              boxShadow="0 8px 32px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 162, 255, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
              overflow="hidden"
              p={4}
              mb={2}
            >
              <Box
                position="absolute"
                left={0}
                top={0}
                width="30px"
                height="100%"
                background="linear-gradient(90deg, rgba(0, 162, 255, 0.6) 0%, transparent 100%)"
                pointerEvents="none"
              />
              <VStack spacing={2} position="relative" zIndex={1}>
                <Text
                  fontSize="md"
                  align="center"
                  color="#f1f5f9"
                  fontWeight="500"
                >
                  Not in database
                </Text>
                <Text
                  fontSize="lg"
                  align="center"
                  color="#00a2ff"
                  fontWeight="600"
                >
                  Add to TruthTrollers?
                </Text>
              </VStack>
            </Box>
            <Center>
              <HStack spacing={3} mt={2}>
                <button
                  className="mr-button"
                  onClick={handleAddTask}
                  disabled={loading}
                  style={{ opacity: loading ? 0.5 : 1 }}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>
                    {loading ? "Adding..." : "Add"}
                  </span>
                </button>
                <button
                  className="mr-button"
                  onClick={() => {
                    setVisible(false);
                    const popupRoot = document.getElementById("popup-root");
                    if (popupRoot) {
                      popupRoot.classList.add("task-card-hidden");
                      popupRoot.classList.remove("task-card-visible");
                    }
                  }}
                >
                  <span style={{ position: "relative", zIndex: 1 }}>Close</span>
                </button>
              </HStack>
            </Center>
          </Box>
        )}
      </VStack>
    </Box>
  );
};

export default TaskCard;
