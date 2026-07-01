// src/pages/EmailTesterPage.tsx
import React, { useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  HStack,
  Heading,
  Text,
  useToast,
  Radio,
  RadioGroup,
  Stack,
  Divider,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Code,
  Badge,
} from "@chakra-ui/react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const EmailTesterPage: React.FC = () => {
  const [email, setEmail] = useState("");
  const [emailType, setEmailType] = useState<"reset" | "confirmation">("reset");
  const [isSending, setIsSending] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const toast = useToast();

  const handleTestEmail = async () => {
    if (!email) {
      toast({
        title: "Email Required",
        description: "Please enter an email address",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      return;
    }

    setIsSending(true);
    setLastResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/test-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: emailType }),
      });

      const data = await response.json();

      if (response.ok) {
        setLastResult({ success: true, ...data });
        toast({
          title: "Email Sent Successfully",
          description: `${emailType === "reset" ? "Password reset" : "Confirmation"} email sent to ${email}`,
          status: "success",
          duration: 5000,
          isClosable: true,
        });
      } else {
        throw new Error(data.error || "Failed to send email");
      }
    } catch (error: any) {
      setLastResult({ success: false, error: error.message });
      toast({
        title: "Email Send Failed",
        description: error.message || "An error occurred",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Box p={8} maxW="800px" mx="auto">
      <VStack spacing={6} align="stretch">
        <Box>
          <Heading size="lg" mb={2}>
            📧 Email System Tester
          </Heading>
          <Text color="gray.500">
            Test your SMTP email configuration and templates
          </Text>
        </Box>

        <Divider />

        <Alert status="info" borderRadius="md">
          <AlertIcon />
          <Box>
            <AlertTitle>SMTP Configuration</AlertTitle>
            <AlertDescription>
              <VStack align="start" spacing={1} fontSize="sm">
                <Text><strong>Host:</strong> {import.meta.env.VITE_API_BASE_URL}</Text>
                <Text><strong>From:</strong> admin@truthtrollers.com</Text>
                <Text><strong>Port:</strong> 587 (TLS)</Text>
              </VStack>
            </AlertDescription>
          </Box>
        </Alert>

        <Box
          p={6}
          borderWidth="1px"
          borderRadius="lg"
          bg="gray.50"
          _dark={{ bg: "gray.800" }}
        >
          <VStack spacing={4} align="stretch">
            <FormControl isRequired>
              <FormLabel>Recipient Email</FormLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="test@example.com"
                size="lg"
              />
            </FormControl>

            <FormControl>
              <FormLabel>Email Template</FormLabel>
              <RadioGroup onChange={(val) => setEmailType(val as any)} value={emailType}>
                <Stack direction="column" spacing={3}>
                  <Radio value="reset">
                    <HStack>
                      <Text fontWeight="semibold">Password Reset Email</Text>
                      <Badge colorScheme="blue">With Reset Link</Badge>
                    </HStack>
                    <Text fontSize="sm" color="gray.600" ml={6}>
                      Branded email with reset token link (expires in 1 hour)
                    </Text>
                  </Radio>
                  <Radio value="confirmation">
                    <HStack>
                      <Text fontWeight="semibold">Password Changed Confirmation</Text>
                      <Badge colorScheme="green">Security Alert</Badge>
                    </HStack>
                    <Text fontSize="sm" color="gray.600" ml={6}>
                      Notification email after successful password change
                    </Text>
                  </Radio>
                </Stack>
              </RadioGroup>
            </FormControl>

            <Button
              colorScheme="teal"
              size="lg"
              onClick={handleTestEmail}
              isLoading={isSending}
              loadingText="Sending..."
              isDisabled={!email}
            >
              Send Test Email
            </Button>
          </VStack>
        </Box>

        {lastResult && (
          <Alert
            status={lastResult.success ? "success" : "error"}
            borderRadius="md"
            flexDirection="column"
            alignItems="start"
          >
            <HStack mb={2}>
              <AlertIcon />
              <AlertTitle>
                {lastResult.success ? "Email Sent" : "Send Failed"}
              </AlertTitle>
            </HStack>
            <AlertDescription width="100%">
              {lastResult.success ? (
                <VStack align="start" spacing={2} fontSize="sm">
                  <Text>
                    <strong>To:</strong> {email}
                  </Text>
                  <Text>
                    <strong>Type:</strong> {lastResult.type}
                  </Text>
                  <Text color="green.700" _dark={{ color: "green.300" }}>
                    ✓ Check your inbox (and spam folder)
                  </Text>
                </VStack>
              ) : (
                <Code colorScheme="red" p={2} borderRadius="md" width="100%">
                  {lastResult.error}
                </Code>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Box
          p={4}
          borderWidth="1px"
          borderRadius="md"
          bg="blue.50"
          _dark={{ bg: "blue.900", borderColor: "blue.700" }}
        >
          <Heading size="sm" mb={2}>
            💡 Testing Tips
          </Heading>
          <VStack align="start" spacing={2} fontSize="sm">
            <Text>• Check spam folder if email doesn't arrive within 1 minute</Text>
            <Text>• Reset email links will have test tokens (won't work for actual reset)</Text>
            <Text>• Confirmation emails show current timestamp</Text>
            <Text>• All emails are branded with Truthtrollers styling</Text>
          </VStack>
        </Box>
      </VStack>
    </Box>
  );
};

export default EmailTesterPage;
