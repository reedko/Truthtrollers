import React from "react";
import {
  Box,
  Heading,
  Text,
  VStack,
  HStack,
  Button,
  Link,
  Code,
  Divider,
  OrderedList,
  ListItem,
  Alert,
  AlertIcon,
} from "@chakra-ui/react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://localhost:5001";
const ZIP_URL = `${API_BASE_URL}/assets/extension/truthtrollers_extension.zip`;
// If you later build a Firefox XPI, add it here:
// const XPI_URL = `${API_BASE_URL}/assets/extension/truthtrollers_extension.xpi`;

const ExtensionDownloadPage: React.FC = () => {
  return (
    <Box maxW="900px" mx="auto" py={6}>
      <Heading size="lg" mb={2}>
        TruthTrollers Browser Extension
      </Heading>
      <Text color="gray.300" mb={6}>
        Download the extension and follow the steps below to install it in your
        browser.
      </Text>

      <VStack align="stretch" spacing={4}>
        <HStack spacing={3}>
          <Button
            as={Link}
            href={ZIP_URL}
            colorScheme="teal"
            size="md"
            isExternal
          >
            Download ZIP (unpacked)
          </Button>
          {/* Uncomment if you ship a signed Firefox build
          <Button as={Link} href={XPI_URL} colorScheme="purple" size="md" isExternal>
            Download Firefox XPI
          </Button> */}
        </HStack>

        <Alert status="warning" borderRadius="md">
          <AlertIcon />
          <VStack align="start" spacing={1}>
            <Text fontWeight="bold">
              Important: You must UNZIP the downloaded file first!
            </Text>
            <Text fontSize="sm">
              The ZIP contains the <Code>extension/</Code> folder as an unpacked
              extension. Extract it completely before loading in your browser.
            </Text>
          </VStack>
        </Alert>

        <Divider />

        <Heading size="md">Chrome / Edge (Unpacked)</Heading>
        <OrderedList spacing={2}>
          <ListItem>
            <b>Download and UNZIP:</b> Extract the ZIP file to a permanent folder on your computer
            (e.g., <Code>~/Documents/TruthTrollers/extension</Code>).
            <Alert status="info" mt={2} fontSize="sm">
              <AlertIcon />
              Don't delete this folder after installation — the browser loads the extension from this location.
            </Alert>
          </ListItem>
          <ListItem>
            Open <Code>chrome://extensions</Code> (or{" "}
            <Code>edge://extensions</Code>).
          </ListItem>
          <ListItem>
            Enable <b>Developer mode</b> (top-right).
          </ListItem>
          <ListItem>
            Click <b>Load unpacked</b> and select the extracted{" "}
            <Code>extension/</Code> folder.
          </ListItem>
          <ListItem>
            <b>Pin the icon:</b> click the <b>Extensions</b> (puzzle) button in
            the toolbar → find <b>TruthTrollers</b> → click the <b>pin</b> icon.
            (Edge: “Show in toolbar”.)
          </ListItem>
          <ListItem>
            (Optional) In <Code>chrome://extensions</Code> → <b>Details</b>,
            enable
            <b> Allow access to file URLs</b> if your workflows load local
            files.
          </ListItem>
        </OrderedList>

        <Heading size="md" mt={6}>
          Firefox (Temporary Add-on)
        </Heading>
        <OrderedList spacing={2}>
          <ListItem>
            <b>Download and UNZIP:</b> Extract the ZIP file to a permanent folder on your computer.
            <Alert status="info" mt={2} fontSize="sm">
              <AlertIcon />
              Keep the extracted folder — Firefox loads from this location.
            </Alert>
          </ListItem>
          <ListItem>
            Open <Code>about:debugging#/runtime/this-firefox</Code>.
          </ListItem>
          <ListItem>
            Click <b>Load Temporary Add-on</b>, choose{" "}
            <Code>manifest.json</Code> from the extracted{" "}
            <Code>extension/</Code> folder.
          </ListItem>
          <ListItem>
            <b>Pin the icon:</b> click the <b>Extensions</b> (puzzle) button →
            the <b>gear</b> next to <b>TruthTrollers</b> → <b>Pin to Toolbar</b>
            . (Or right-click the toolbar → <b>Customize Toolbar…</b> and drag
            the icon in.)
          </ListItem>
          <ListItem>
            (Optional) If you later provide a signed <Code>.xpi</Code>, just
            open it in Firefox to install permanently.
          </ListItem>
        </OrderedList>

        <Divider />

        <Heading size="sm">Troubleshooting</Heading>
        <Text fontSize="sm" color="gray.300">
          If the extension can’t reach the API, check your dashboard build uses
          the correct <Code>VITE_API_BASE_URL</Code> and your backend
          CORS/static assets are accessible at <Code>{API_BASE_URL}</Code>.
        </Text>
      </VStack>
    </Box>
  );
};

export default ExtensionDownloadPage;
