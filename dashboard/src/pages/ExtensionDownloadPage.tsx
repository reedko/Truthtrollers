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

        <Alert status="info" borderRadius="md">
          <AlertIcon />
          This ZIP contains the <Code>extension/</Code> folder as an unpacked
          extension. You can load it in Chrome/Edge via Developer Mode. For
          Firefox, use temporary add-on loading.
        </Alert>

        <Divider />

        <Heading size="md">Chrome / Edge (Unpacked)</Heading>
        <OrderedList spacing={2}>
          <ListItem>Extract the ZIP to a folder on your computer.</ListItem>
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
        </OrderedList>

        <Heading size="md" mt={6}>
          Firefox (Temporary Add-on)
        </Heading>
        <OrderedList spacing={2}>
          <ListItem>Extract the ZIP to a folder.</ListItem>
          <ListItem>
            Open <Code>about:debugging#/runtime/this-firefox</Code>.
          </ListItem>
          <ListItem>
            Click <b>Load Temporary Add-on</b>, pick any file inside the
            extracted <Code>extension/</Code> folder (e.g.,{" "}
            <Code>manifest.json</Code>).
          </ListItem>
          <ListItem>
            (Optional) If you later provide a signed <Code>.xpi</Code>, just
            open it in Firefox to install.
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
